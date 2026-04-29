/// Thai government lottery prize tiers (สลากกินแบ่งรัฐบาลไทย).
///
/// Each draw distributes prizes across these tiers. Amounts shown are the
/// official baseline payouts in Thai Baht — keep in sync with GLO if changed.
enum PrizeTier {
  first(label: 'รางวัลที่ 1', amount: 6000000),
  firstNear(label: 'รางวัลข้างเคียงรางวัลที่ 1', amount: 100000),
  second(label: 'รางวัลที่ 2', amount: 200000),
  third(label: 'รางวัลที่ 3', amount: 80000),
  fourth(label: 'รางวัลที่ 4', amount: 40000),
  fifth(label: 'รางวัลที่ 5', amount: 20000),
  threeDigitFront(label: 'เลขหน้า 3 ตัว', amount: 4000),
  threeDigitBack(label: 'เลขท้าย 3 ตัว', amount: 4000),
  twoDigitBack(label: 'เลขท้าย 2 ตัว', amount: 2000);

  const PrizeTier({required this.label, required this.amount});

  final String label;
  final int amount;
}
