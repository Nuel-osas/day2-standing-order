#[test_only, allow(implicit_const_copy)]
module standing_order::merchant_tests;

use std::unit_test::destroy;
use sui::allowance::{Self, Allowance};
use sui::balance::Balance;
use sui::clock;
use sui::sui::SUI;
use sui::test_scenario as ts;
use standing_order::merchant::{Self, Merchant, MerchantApp, MerchantCap, Subscription};

const ADMIN: address = @0xAD;
const SPENDER: address = @0x5E;
const ALICE: address = @0xA1;
const PRICE: u64 = 50_000;

fun setup(rate: u256): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    let cap = merchant::create<SUI>(PRICE, ADMIN, SPENDER, s.ctx());
    transfer::public_transfer(cap, ADMIN);
    s.next_tx(ALICE);
    let m = s.take_shared<Merchant<SUI>>();
    let proposal = allowance::propose_for_app<Balance<SUI>, MerchantApp>(
        b"Standing Order".to_string(),
        SPENDER,
        option::none(),
        option::none(),
        option::none(),
        option::some(allowance::monthly_rate_limit(rate)),
        s.ctx(),
    );
    m.subscribe(proposal, s.ctx());
    ts::return_shared(m);
    s.next_tx(ADMIN);
    s
}

fun deliver(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<MerchantCap>();
    let mut sub = s.take_shared<Subscription>();
    merchant::deliver(&cap, &mut sub);
    ts::return_shared(sub);
    s.return_to_sender(cap);
}

fun charge(s: &mut ts::Scenario, amount: u256, now_ms: u64) {
    s.next_tx(SPENDER);
    let m = s.take_shared<Merchant<SUI>>();
    let mut sub = s.take_shared<Subscription>();
    let mut a = s.take_shared<Allowance<Balance<SUI>>>();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.set_for_testing(now_ms);
    let w = allowance::new_withdrawal_for_testing<Balance<SUI>>(object::id(&a), ALICE, amount);
    m.charge(&mut sub, &mut a, w, &clk, s.ctx());
    clk.destroy_for_testing();
    ts::return_shared(a);
    ts::return_shared(sub);
    ts::return_shared(m);
}

#[test]
fun subscribe_issues_app_bound_allowance() {
    let mut s = setup((PRICE as u256));
    let a = s.take_shared<Allowance<Balance<SUI>>>();
    assert!(a.settings().funder() == ALICE);
    assert!(a.settings().spender().contains(&SPENDER));
    assert!(a.settings().app().is_some());
    ts::return_shared(a);
    s.end();
}

#[test]
fun charge_after_delivery() {
    let mut s = setup((PRICE as u256));
    deliver(&mut s);
    charge(&mut s, (PRICE as u256), 1_000);
    s.next_tx(ADMIN);
    let sub = s.take_shared<Subscription>();
    assert!(sub.charged() == 1);
    assert!(sub.bound_allowance().is_some());
    ts::return_shared(sub);
    s.end();
}

#[test, expected_failure(abort_code = merchant::ENothingDue)]
fun charge_without_delivery_aborts() {
    let mut s = setup((PRICE as u256));
    charge(&mut s, (PRICE as u256), 1_000);
    s.end();
}

#[test, expected_failure(abort_code = allowance::EExceedsRateLimit)]
fun second_charge_same_month_aborts() {
    let mut s = setup((PRICE as u256));
    deliver(&mut s);
    deliver(&mut s);
    charge(&mut s, (PRICE as u256), 1_000);
    charge(&mut s, (PRICE as u256), 2_000);
    s.end();
}

#[test]
fun second_charge_next_month_succeeds() {
    let mut s = setup((PRICE as u256));
    deliver(&mut s);
    deliver(&mut s);
    charge(&mut s, (PRICE as u256), 1_000);
    charge(&mut s, (PRICE as u256), 1_000 + 31 * 86_400_000);
    s.end();
}

#[test, expected_failure(abort_code = merchant::EWrongAmount)]
fun overcharge_aborts() {
    let mut s = setup((PRICE as u256) * 2);
    deliver(&mut s);
    charge(&mut s, (PRICE as u256) * 2, 1_000);
    s.end();
}

#[test, expected_failure(abort_code = merchant::ERateLimitBelowPrice)]
fun proposal_below_price_aborts() {
    let s = setup((PRICE as u256) - 1);
    s.end();
}

#[test, expected_failure(abort_code = merchant::EWrongSpender)]
fun proposal_wrong_spender_aborts() {
    let mut s = ts::begin(ADMIN);
    let cap = merchant::create<SUI>(PRICE, ADMIN, SPENDER, s.ctx());
    destroy(cap);
    s.next_tx(ALICE);
    let m = s.take_shared<Merchant<SUI>>();
    let proposal = allowance::propose_for_app<Balance<SUI>, MerchantApp>(
        b"x".to_string(), ALICE, option::none(), option::none(), option::none(),
        option::some(allowance::monthly_rate_limit((PRICE as u256))), s.ctx(),
    );
    m.subscribe(proposal, s.ctx());
    abort 0
}

#[test]
fun rotate_spender_moves_allowance() {
    let mut s = setup((PRICE as u256));
    let cap = s.take_from_sender<MerchantCap>();
    let mut m = s.take_shared<Merchant<SUI>>();
    let mut a = s.take_shared<Allowance<Balance<SUI>>>();
    merchant::rotate_spender(&cap, &mut m, &mut a, @0x77);
    assert!(a.settings().spender().contains(&@0x77));
    assert!(m.spender() == @0x77);
    ts::return_shared(a);
    ts::return_shared(m);
    s.return_to_sender(cap);
    s.end();
}

#[test, expected_failure(abort_code = allowance::EHasApp)]
fun direct_spend_on_app_bound_aborts() {
    let mut s = setup((PRICE as u256));
    s.next_tx(SPENDER);
    let mut a = s.take_shared<Allowance<Balance<SUI>>>();
    let clk = clock::create_for_testing(s.ctx());
    let w = allowance::new_withdrawal_for_testing<Balance<SUI>>(object::id(&a), ALICE, (PRICE as u256));
    let b = allowance::balance_spend(&mut a, w, &clk, s.ctx());
    destroy(b);
    abort 0
}
