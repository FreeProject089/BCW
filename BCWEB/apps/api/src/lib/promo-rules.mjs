// When a promo code applies.
//
// It lives on its own because it is the answer to one question asked from two places — the
// single-repo checkout and the cart — and this repository has already shipped a rule that
// was written twice and diverged. Adding "or a big enough basket" to a bare `minMonths`
// comparison in two files is exactly how that happens again.

/**
 * Does this cart satisfy the code's minimum?
 *
 * `months` is the longest hosting term in the cart, `subtotalCents` the pre-discount total.
 *
 * When a code sets BOTH a minimum term and a minimum amount, EITHER satisfies it — that is
 * what "3 months or more, or $10 or more" means, and reading it as an AND would make every
 * winner's code unusable on the small purchase it was meant to sweeten. When only one is
 * set, only that one is tested. When neither is set, nothing is required.
 *
 * Called by both checkout paths. It used to be a bare `promo.minMonths && months <
 * promo.minMonths` written once per path, which is the shape that diverges the moment a
 * second condition appears — and this IS that second condition.
 */
export function promoMeetsMinimum(promo, { months = 0, subtotalCents = 0 } = {}) {
    const needMonths = promo?.minMonths || 0;
    const needAmount = promo?.minAmountCents || 0;
    if (!needMonths && !needAmount) return { ok: true };
    const byMonths = needMonths > 0 && months >= needMonths;
    const byAmount = needAmount > 0 && subtotalCents >= needAmount;
    if (byMonths || byAmount) return { ok: true };
    return {
        ok: false,
        error: 'promo_minimum',
        minMonths: needMonths || null,
        minAmountCents: needAmount || null,
    };
}
