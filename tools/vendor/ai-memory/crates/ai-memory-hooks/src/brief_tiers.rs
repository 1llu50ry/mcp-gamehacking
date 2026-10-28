//! Tier assignment for the SessionStart project brief.
//!
//! The brief used to stream full page bodies until the budget ran out, so
//! one long `_rules/` page truncated and every later standing page was
//! reduced to an "omitted" pointer. Assignment here is coverage-first: every
//! page that fits gets its L0 excerpt (or a bare path line when it has none),
//! then whatever budget is left deepens pages to L1 and full L2 bodies,
//! privileged (pinned or `_slots/`) pages first. An L2 is taken only whole,
//! never truncated.
//!
//! This module only does the arithmetic over rendered byte costs; the hook
//! router owns the strings and the security scaffold around them.

/// A body at most this many bytes longer than what its page already shows
/// is completed even while other pages still wait for their L1: the rest of
/// such a page costs about what a second heading would.
const SHORT_BODY_SLACK: usize = 128;

/// How deep a core page renders in the brief. Ordered by depth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BriefTier {
    /// Crowded out: listed in the omitted section by path only.
    Omitted,
    /// No excerpt to show: rendered as a bare path line.
    TitleOnly,
    /// Heading plus the short excerpt.
    L0,
    /// Heading plus the longer excerpt.
    L1,
    /// Heading plus the whole body.
    L2,
}

/// Rendered byte cost of one core page at each depth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PageCosts {
    /// Pinned or `_slots/`: deepened before every other page.
    pub privileged: bool,
    /// Cost as a bare path line.
    pub title_only: usize,
    /// Costs at L0, L1 and L2, or `None` when the page has no excerpt and
    /// can only render as a path line.
    pub tiers: Option<[usize; 3]>,
}

impl PageCosts {
    fn cost(&self, tier: BriefTier) -> usize {
        match (tier, self.tiers) {
            (BriefTier::Omitted, _) => 0,
            (BriefTier::L0, Some([l0, _, _])) => l0,
            (BriefTier::L1, Some([_, l1, _])) => l1,
            (BriefTier::L2, Some([_, _, l2])) => l2,
            _ => self.title_only,
        }
    }

    /// Whether deepening to L1 would show anything L0 does not.
    fn l1_adds(&self) -> bool {
        self.tiers.is_some_and(|[l0, l1, _]| l1 > l0)
    }
}

/// The fixed parts of the budget the pages compete inside.
#[derive(Debug, Clone, Copy)]
pub(crate) struct BriefBudget {
    /// Bytes already spent before the first page (preamble, notice, fence).
    pub prefix: usize,
    /// The budget minus everything from the closing fence onward.
    pub content_ceiling: usize,
    /// The recent-pages section at full length.
    pub recent_full: usize,
    /// The shortest recent-pages section that shows anything: its header and
    /// first line. A reserve below this buys nothing.
    pub recent_first: usize,
}

/// The assignment: a tier per core page and what is held back for the
/// sections rendered after the pages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BriefPlan {
    /// One tier per core page, in store order. The omitted pages are always
    /// a suffix.
    pub tiers: Vec<BriefTier>,
    /// Index of the first omitted page (`tiers.len()` when none is).
    pub omitted_from: usize,
    /// Bytes the recent section keeps when the omitted section is rendered.
    pub recent_reserve: usize,
}

/// Assign a tier to every core page.
///
/// `omitted_full(from)` is the length of the omitted section listing every
/// page from `from` on, and `count_only(n)` the length of its shortest form,
/// the bare count of `n` pages.
pub(crate) fn assign_tiers(
    pages: &[PageCosts],
    budget: BriefBudget,
    omitted_full: impl Fn(usize) -> usize,
    count_only: impl Fn(usize) -> usize,
) -> BriefPlan {
    let mut tiers = vec![BriefTier::Omitted; pages.len()];
    let variable = budget.content_ceiling.saturating_sub(budget.prefix);
    // Recent titles are held to a quarter of what is left, but never to
    // less than one line: a share too small to render is not a reserve.
    let recent_share = |left: usize| budget.recent_full.min((left / 4).max(budget.recent_first));
    let recent_cap = recent_share(variable);
    // A crowded-out page is a standing rule the agent did not receive, so
    // the count of omitted pages is reserved before coverage starts. It is
    // sized for every page being omitted, which is the most digits it needs.
    let omitted_floor = if pages.is_empty() {
        0
    } else {
        count_only(pages.len())
    };
    let coverage_ceiling = budget
        .content_ceiling
        .saturating_sub(recent_cap + omitted_floor);

    let mut spent = budget.prefix;
    let mut omitted_from = pages.len();
    for (idx, page) in pages.iter().enumerate() {
        let tier = match page.tiers {
            // A body cheaper than its excerpt is covered whole, at its own
            // cost, instead of crowding later pages out at the excerpt's.
            Some([l0, _, l2]) if l2 < l0 => BriefTier::L2,
            Some(_) => BriefTier::L0,
            None => BriefTier::TitleOnly,
        };
        let cost = page.cost(tier);
        if spent + cost > coverage_ceiling {
            omitted_from = idx;
            break;
        }
        tiers[idx] = tier;
        spent += cost;
    }

    let remaining = budget.content_ceiling.saturating_sub(spent);
    let omitted_reserve = if omitted_from == pages.len() {
        0
    } else {
        omitted_full(omitted_from)
            .min(remaining / 4)
            .max(count_only(pages.len() - omitted_from))
            .min(remaining)
    };
    let after_omitted = remaining.saturating_sub(omitted_reserve);
    let recent_reserve = recent_share(after_omitted).min(after_omitted);
    let mut room = remaining.saturating_sub(omitted_reserve + recent_reserve);

    let included = &pages[..omitted_from];
    let (privileged, unprivileged): (Vec<usize>, Vec<usize>) =
        (0..omitted_from).partition(|&idx| pages[idx].privileged);
    let delta = |tiers: &[BriefTier], idx: usize, target: BriefTier| {
        let page = &pages[idx];
        match (page.tiers, tiers[idx]) {
            (Some(_), current) if current != BriefTier::TitleOnly && current < target => page
                .cost(target)
                .checked_sub(page.cost(current))
                .filter(|d| *d > 0),
            _ => None,
        }
    };
    // A frontmatter excerpt can be longer than the body it describes
    // (#1360). Showing that body whole then costs less than the excerpt, so
    // the swap is free and returns the difference to the room.
    let saving = |tiers: &[BriefTier], idx: usize, target: BriefTier| {
        let page = &pages[idx];
        match (page.tiers, tiers[idx]) {
            (Some(_), current)
                if target == BriefTier::L2
                    && current != BriefTier::TitleOnly
                    && current < target =>
            {
                page.cost(current)
                    .checked_sub(page.cost(target))
                    .filter(|s| *s > 0)
            }
            _ => None,
        }
    };
    let mut promote =
        |tiers: &mut [BriefTier], order: &[usize], target: BriefTier, max_delta: usize| {
            for &idx in order {
                if let Some(s) = saving(tiers, idx, target) {
                    tiers[idx] = target;
                    room += s;
                } else if let Some(d) = delta(tiers, idx, target)
                    && d <= room.min(max_delta)
                {
                    tiers[idx] = target;
                    room -= d;
                }
            }
        };
    promote(&mut tiers, &privileged, BriefTier::L1, usize::MAX);
    promote(&mut tiers, &privileged, BriefTier::L2, usize::MAX);
    promote(&mut tiers, &unprivileged, BriefTier::L1, usize::MAX);
    promote(&mut tiers, &unprivileged, BriefTier::L2, SHORT_BODY_SLACK);
    // Full bodies for the remaining pages only once every included page
    // shows as much as its L1 can: a long body must not outbid a summary.
    // Cheapest first, so the room left shows as many whole pages as it can.
    let every_page_at_l1 = included
        .iter()
        .zip(&tiers)
        .all(|(page, tier)| *tier >= BriefTier::L1 || !page.l1_adds());
    if every_page_at_l1 {
        let mut cheapest = unprivileged;
        cheapest.sort_by_key(|&idx| (delta(&tiers, idx, BriefTier::L2), idx));
        promote(&mut tiers, &cheapest, BriefTier::L2, usize::MAX);
    }

    BriefPlan {
        tiers,
        omitted_from,
        recent_reserve,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use BriefTier::{L0, L1, L2, Omitted, TitleOnly};

    const COUNT_ONLY: usize = 60;
    const RECENT_FIRST: usize = 120;
    const LISTED: usize = 30;

    fn page(privileged: bool, l0: usize, l1: usize, l2: usize) -> PageCosts {
        PageCosts {
            privileged,
            title_only: 20,
            tiers: Some([l0, l1, l2]),
        }
    }

    fn assign(pages: &[PageCosts], content_ceiling: usize, recent_full: usize) -> BriefPlan {
        assign_tiers(
            pages,
            BriefBudget {
                prefix: 100,
                content_ceiling,
                recent_full,
                recent_first: recent_full.min(RECENT_FIRST),
            },
            |from| 40 + LISTED * (pages.len() - from),
            |_| COUNT_ONLY,
        )
    }

    fn spent(pages: &[PageCosts], plan: &BriefPlan) -> usize {
        pages.iter().zip(&plan.tiers).map(|(p, t)| p.cost(*t)).sum()
    }

    #[test]
    fn a_long_first_body_does_not_crowd_out_later_pages() {
        let pages = [page(false, 100, 400, 5_000), page(false, 100, 400, 300)];
        let plan = assign(&pages, 1_000, 0);
        assert_eq!(plan.omitted_from, 2, "both pages are covered");
        assert!(plan.tiers.iter().all(|t| *t >= L0), "{plan:?}");
        assert_ne!(
            plan.tiers[0], L2,
            "a body that does not fit whole stays an excerpt"
        );
    }

    #[test]
    fn coverage_keeps_room_for_the_omitted_count() {
        let pages = vec![page(false, 150, 150, 150); 24];
        let ceiling = 2_000;
        let plan = assign(&pages, ceiling, 0);
        assert!(
            (1..24).contains(&plan.omitted_from),
            "some but not every page fits: {plan:?}"
        );
        assert!(
            plan.tiers[plan.omitted_from..]
                .iter()
                .all(|t| *t == Omitted),
            "omitted pages are a suffix"
        );
        assert!(
            100 + spent(&pages, &plan) + COUNT_ONLY <= ceiling,
            "the omitted count still fits after coverage"
        );
    }

    #[test]
    fn privileged_pages_deepen_first() {
        let pages = [
            page(false, 100, 400, 900),
            page(true, 100, 400, 900),
            page(false, 100, 400, 900),
        ];
        // Room for the three L0s plus one body.
        let plan = assign(&pages, 100 + 300 + 800, 0);
        assert_eq!(plan.tiers, vec![L0, L2, L0]);
    }

    #[test]
    fn summaries_come_before_unprivileged_bodies() {
        let pages = [page(false, 100, 400, 450), page(false, 100, 400, 450)];
        // Room for both L1s but not for a body on top of them.
        let plan = assign(&pages, 100 + 800 + 40, 0);
        assert_eq!(plan.tiers, vec![L1, L1]);
        // One L1 does not fit: no long unprivileged body may jump the queue
        // (a body within `SHORT_BODY_SLACK` of its excerpt is the exception).
        let pages = [page(false, 100, 900, 950), page(false, 100, 150, 600)];
        let plan = assign(&pages, 100 + 200 + 100, 0);
        assert_eq!(plan.tiers, vec![L0, L1]);
    }

    #[test]
    fn a_small_wiki_gets_every_body_whole() {
        let pages = [
            page(false, 80, 80, 120),
            page(false, 60, 90, 200),
            page(true, 50, 50, 300),
        ];
        let plan = assign(&pages, 4_000, 500);
        assert_eq!(plan.tiers, vec![L2, L2, L2]);
        assert_eq!(plan.omitted_from, 3);
    }

    #[test]
    fn a_body_cheaper_than_its_excerpt_shows_whole() {
        // A frontmatter `summary:` or `abstract:` can be longer than the body
        // it describes (#1360). The body then costs less than the excerpt the
        // page shows: less than its L0 (the first three), or only less than
        // the L1 a short `abstract:` makes way for (the last two).
        let pages = [
            page(true, 256, 500, 120),
            page(false, 256, 500, 120),
            page(false, 300, 300, 200),
            page(true, 100, 500, 200),
            page(false, 100, 500, 200),
        ];
        let plan = assign(&pages, 4_000, 0);
        assert_eq!(plan.tiers, vec![L2; 5]);
    }

    #[test]
    fn the_bytes_a_cheaper_body_saves_go_to_other_pages() {
        // After coverage, 400 bytes are left. The first page takes its
        // 500-byte L1 (all 400), then swaps it for its 150-byte body, which
        // frees 350. That pays for the second page's body (250 more than its
        // excerpt), which no longer fits without the refund.
        let pages = [page(true, 100, 500, 150), page(true, 100, 100, 350)];
        let plan = assign(&pages, 100 + 200 + 400, 0);
        assert_eq!(plan.tiers, vec![L2, L2]);
        assert!(100 + spent(&pages, &plan) <= 700, "{plan:?}");
    }

    #[test]
    fn a_body_cheaper_than_its_excerpt_is_covered_at_its_own_cost() {
        // Ten 300-byte excerpts do not fit; ten 50-byte bodies do. Priced at
        // the excerpt, most of these pages would be omitted.
        let pages = vec![page(false, 300, 300, 50); 10];
        let plan = assign(&pages, 100 + 1_000 + COUNT_ONLY, 0);
        assert_eq!(plan.omitted_from, 10, "{plan:?}");
        assert_eq!(plan.tiers, vec![L2; 10]);
    }

    #[test]
    fn zero_delta_and_title_only_pages_do_not_block_bodies() {
        let pages = [
            PageCosts {
                privileged: false,
                title_only: 20,
                tiers: None,
            },
            page(false, 50, 50, 50),
            page(false, 50, 50, 400),
        ];
        let plan = assign(&pages, 4_000, 0);
        assert_eq!(plan.tiers, vec![TitleOnly, L0, L2]);
    }

    #[test]
    fn recent_titles_keep_a_share_of_what_is_left() {
        let pages = [page(false, 100, 100, 10_000)];
        let plan = assign(&pages, 2_000, 600);
        assert!(plan.recent_reserve > 0, "{plan:?}");
        let pages = [page(false, 100, 100, 10_000)];
        let plan = assign(&pages, 2_000, 0);
        assert_eq!(
            plan.recent_reserve, 0,
            "nothing held back when nothing is recent"
        );
    }

    #[test]
    fn the_recent_reserve_holds_at_least_one_line() {
        // A quarter of what is left would be 87 bytes, less than the 120 a
        // first recent line needs: such a reserve buys nothing, and the
        // promotion that eats the rest leaves the recent section empty.
        let pages = [page(true, 280, 520, 5_000)];
        let ceiling = 100 + 280 + 350;
        let plan = assign(&pages, ceiling, 400);
        assert!(plan.recent_reserve >= RECENT_FIRST, "{plan:?}");
        assert!(
            100 + spent(&pages, &plan) + plan.recent_reserve <= ceiling,
            "{plan:?}"
        );
    }

    #[test]
    fn a_body_almost_shown_is_completed_even_when_a_summary_did_not_fit() {
        // The first page's L1 does not fit, which holds back every other
        // unprivileged body; the second page is 60 bytes from whole.
        let pages = [page(false, 100, 900, 950), page(false, 100, 100, 160)];
        let plan = assign(&pages, 100 + 200 + 200, 0);
        assert_eq!(plan.tiers, vec![L0, L2]);
    }

    #[test]
    fn cheaper_bodies_go_first_so_more_pages_show_whole() {
        // Room for 400 bytes of bodies: the first page alone, or both of
        // the others.
        let pages = [
            page(false, 100, 100, 500),
            page(false, 100, 100, 300),
            page(false, 100, 100, 300),
        ];
        let plan = assign(&pages, 100 + 300 + 400, 0);
        assert_eq!(plan.tiers, vec![L0, L2, L2]);
    }

    #[test]
    fn no_pages_is_an_empty_plan() {
        let plan = assign(&[], 4_000, 100);
        assert_eq!(plan.tiers, Vec::<BriefTier>::new());
        assert_eq!(plan.omitted_from, 0);
    }

    /// Randomized invariants over the assignment, driven by a fixed-seed
    /// xorshift (the seed is in every failure message). The `stress_`
    /// prefix keeps it out of the everyday `cargo t` profile; `cargo tf`,
    /// the pre-push hook and CI run it.
    mod stress_assignment {
        use super::*;

        struct Rng(u64);
        impl Rng {
            fn next(&mut self) -> u64 {
                let mut x = self.0;
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                self.0 = x;
                x
            }
            fn below(&mut self, n: usize) -> usize {
                (self.next() % n as u64) as usize
            }
        }

        fn random_page(rng: &mut Rng) -> PageCosts {
            let l0 = 20 + rng.below(320);
            let l1 = l0 + [0, rng.below(300)][rng.below(2)];
            // The last choice is a body shorter than its excerpt, which a long
            // frontmatter `summary:` or `abstract:` produces (#1360).
            let l2 = [
                l1,
                l1 + rng.below(SHORT_BODY_SLACK * 2),
                l1 + rng.below(20_000),
                1 + rng.below(l1),
            ][rng.below(4)];
            PageCosts {
                privileged: rng.below(4) == 0,
                title_only: 10 + rng.below(60),
                tiers: (rng.below(10) != 0).then_some([l0, l1, l2]),
            }
        }

        fn plan(pages: &[PageCosts], ceiling: usize, recent_full: usize) -> BriefPlan {
            assign_tiers(
                pages,
                BriefBudget {
                    prefix: 100,
                    content_ceiling: ceiling,
                    recent_full,
                    recent_first: recent_full.min(RECENT_FIRST),
                },
                |from| 40 + LISTED * (pages.len() - from),
                |_| COUNT_ONLY,
            )
        }

        #[test]
        fn assignment_invariants_hold_for_random_pages_and_budgets() {
            let seed = 0x5eed_b41e_f00d_u64;
            let mut rng = Rng(seed);
            for case in 0..3_000 {
                let pages: Vec<_> = (0..rng.below(25)).map(|_| random_page(&mut rng)).collect();
                let ceiling = 300 + rng.below(20_000);
                let recent_full = [0, 50 + rng.below(800)][rng.below(2)];
                let p = plan(&pages, ceiling, recent_full);
                let ctx =
                    format!("seed {seed:#x} case {case}: {pages:?} ceiling {ceiling} -> {p:?}");

                // Pages and the reserves never exceed the ceiling.
                assert!(
                    100 + spent(&pages, &p) + p.recent_reserve <= ceiling.max(100),
                    "{ctx}"
                );
                // Omitted pages are exactly a suffix.
                assert!(
                    p.tiers[..p.omitted_from].iter().all(|t| *t != Omitted),
                    "{ctx}"
                );
                assert!(
                    p.tiers[p.omitted_from..].iter().all(|t| *t == Omitted),
                    "{ctx}"
                );
                // A page with no excerpt is never deepened.
                for (page, tier) in pages.iter().zip(&p.tiers) {
                    if page.tiers.is_none() {
                        assert!(matches!(tier, TitleOnly | Omitted), "{ctx}");
                    }
                }
                // While some page still waits for an L1 that would add
                // something, an unprivileged body is shown whole only when it
                // was within the short-body slack.
                let gate_closed = pages[..p.omitted_from]
                    .iter()
                    .zip(&p.tiers)
                    .any(|(page, tier)| *tier == L0 && page.l1_adds());
                if gate_closed {
                    for (page, tier) in pages.iter().zip(&p.tiers) {
                        if *tier == L2 && !page.privileged {
                            let [l0, l1, l2] = page.tiers.unwrap();
                            assert!(l2 <= l0.max(l1) + SHORT_BODY_SLACK, "{ctx}");
                        }
                    }
                }
                // A covered page never shows an excerpt that costs more than
                // its whole body.
                for (page, tier) in pages.iter().zip(&p.tiers) {
                    if let Some([_, _, l2]) = page.tiers
                        && matches!(tier, L0 | L1)
                    {
                        assert!(page.cost(*tier) <= l2, "{ctx}");
                    }
                }
                // More budget never covers fewer pages.
                let wider = plan(&pages, ceiling + 1 + rng.below(4_000), recent_full);
                assert!(
                    wider.omitted_from >= p.omitted_from,
                    "{ctx} wider {wider:?}"
                );
            }
        }
    }
}
