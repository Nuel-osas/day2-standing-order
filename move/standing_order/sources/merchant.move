// SPDX-License-Identifier: MIT

/// Standing Order merchant: accepts app-bound allowances and charges them one delivered period at a time.
///
/// A subscriber proposes an allowance bound to `MerchantApp` and passes it to `subscribe` in the
/// same PTB. Only this module can mint `MerchantApp` permits, so every pull against those
/// allowances runs through `charge`, which refuses unless the merchant has delivered a period that
/// has not been charged yet, and always pays the merchant treasury the exact price.
///
/// ### Key Features:
///
/// - Proposals are checked before issue: spender must be the merchant key, rate limit must fit the price
/// - `charge` is the only spend path; the allowance's own rate limit still applies on top
/// - The merchant rotates its spender key without any subscriber signing
module standing_order::merchant;

use std::internal;
use sui::allowance::{Self, Allowance, AllowanceProposal, AllowanceWithdrawal};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::event::emit;

// === Structs ===

/// The app type `A` every Standing Order allowance is bound to.
public struct MerchantApp() has drop;

public struct Merchant<phantom C> has key {
    id: UID,
    price: u64,
    treasury: address,
    spender: address,
}

public struct MerchantCap has key, store {
    id: UID,
    merchant: ID,
}

public struct Subscription has key {
    id: UID,
    merchant: ID,
    subscriber: address,
    allowance: Option<ID>,
    delivered: u64,
    charged: u64,
}

// === Events ===

public struct Subscribed has copy, drop {
    merchant: ID,
    subscription: ID,
    subscriber: address,
}

public struct Delivered has copy, drop {
    subscription: ID,
    delivered: u64,
}

public struct Charged has copy, drop {
    subscription: ID,
    allowance: ID,
    amount: u64,
    period: u64,
}

// === Errors ===

#[error(code = 10)]
const EWrongSpender: vector<u8> = "Proposal must name the merchant's spender";
#[error(code = 11)]
const ENoRateLimit: vector<u8> = "Proposal must carry a rate limit";
#[error(code = 12)]
const ERateLimitBelowPrice: vector<u8> = "Rate limit is below the price of one period";
#[error(code = 20)]
const EWrongMerchant: vector<u8> = "Object belongs to a different merchant";
#[error(code = 21)]
const EWrongSubscriber: vector<u8> = "Allowance is funded by someone other than the subscriber";
#[error(code = 22)]
const EWrongAllowance: vector<u8> = "Subscription is bound to a different allowance";
#[error(code = 30)]
const ENothingDue: vector<u8> = "No delivered period is waiting to be charged";
#[error(code = 31)]
const EWrongAmount: vector<u8> = "Pull must equal the price";

// === Public Functions ===

public fun create<C>(price: u64, treasury: address, spender: address, ctx: &mut TxContext): MerchantCap {
    let merchant = Merchant<C> { id: object::new(ctx), price, treasury, spender };
    let cap = MerchantCap { id: object::new(ctx), merchant: object::id(&merchant) };
    transfer::share_object(merchant);
    cap
}

/// Accepts a subscriber's proposal. Only this function can issue an allowance bound to `MerchantApp`.
public fun subscribe<C>(
    self: &Merchant<C>,
    proposal: AllowanceProposal<Balance<C>>,
    ctx: &mut TxContext,
) {
    let settings = proposal.settings();
    assert!(settings.spender().contains(&self.spender), EWrongSpender);
    let rate_limit = settings.rate_limit();
    assert!(rate_limit.is_some(), ENoRateLimit);
    assert!(rate_limit.destroy_some().limit() >= (self.price as u256), ERateLimitBelowPrice);

    allowance::issue(proposal, allowance::settings_permit(internal::permit<MerchantApp>()), ctx);

    let subscription = Subscription {
        id: object::new(ctx),
        merchant: object::id(self),
        subscriber: ctx.sender(),
        allowance: option::none(),
        delivered: 0,
        charged: 0,
    };
    emit(Subscribed {
        merchant: subscription.merchant,
        subscription: object::id(&subscription),
        subscriber: subscription.subscriber,
    });
    transfer::share_object(subscription);
}

/// Records that one more period of service was delivered and may be charged.
public fun deliver(cap: &MerchantCap, sub: &mut Subscription) {
    assert!(cap.merchant == sub.merchant, EWrongMerchant);
    sub.delivered = sub.delivered + 1;
    emit(Delivered { subscription: object::id(sub), delivered: sub.delivered });
}

/// The only spend path for a `MerchantApp` allowance. The tx sender must be the allowance's spender.
public fun charge<C>(
    self: &Merchant<C>,
    sub: &mut Subscription,
    allowance: &mut Allowance<Balance<C>>,
    withdrawal: AllowanceWithdrawal<Balance<C>>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(sub.merchant == object::id(self), EWrongMerchant);
    assert!(allowance.settings().funder() == sub.subscriber, EWrongSubscriber);
    let allowance_id = object::id(allowance);
    if (sub.allowance.is_none()) sub.allowance.fill(allowance_id);
    assert!(sub.allowance.contains(&allowance_id), EWrongAllowance);
    assert!(sub.charged < sub.delivered, ENothingDue);

    let paid = allowance::app_balance_spend(
        allowance,
        allowance::spend_permit(internal::permit<MerchantApp>()),
        withdrawal,
        clock,
        ctx,
    );
    assert!(paid.value() == self.price, EWrongAmount);
    sub.charged = sub.charged + 1;
    balance::send_funds(paid, self.treasury);

    emit(Charged {
        subscription: object::id(sub),
        allowance: allowance_id,
        amount: self.price,
        period: sub.charged,
    });
}

/// Moves the merchant to a new spender key, one allowance at a time. No subscriber signs.
public fun rotate_spender<C>(
    cap: &MerchantCap,
    self: &mut Merchant<C>,
    allowance: &mut Allowance<Balance<C>>,
    new_spender: address,
) {
    assert!(cap.merchant == object::id(self), EWrongMerchant);
    self.spender = new_spender;
    allowance::rotate_spender(
        allowance,
        allowance::settings_permit(internal::permit<MerchantApp>()),
        new_spender,
    );
}

// === View Functions ===

public fun price<C>(self: &Merchant<C>): u64 { self.price }

public fun treasury<C>(self: &Merchant<C>): address { self.treasury }

public fun spender<C>(self: &Merchant<C>): address { self.spender }

public fun subscriber(sub: &Subscription): address { sub.subscriber }

public fun delivered(sub: &Subscription): u64 { sub.delivered }

public fun charged(sub: &Subscription): u64 { sub.charged }

public fun bound_allowance(sub: &Subscription): Option<ID> { sub.allowance }
