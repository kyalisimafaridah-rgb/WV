"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMomoSms = parseMomoSms;
exports.normaliseForMatch = normaliseForMatch;
exports.reasonMentionsReference = reasonMentionsReference;
/**
 * MTN format (confirmed against a real "received" SMS):
 * "You have received UGX 11000 from Airtel Money on 2026-08-21 12:06:14.
 *  fee:0. Reason: FARIDAH KYALISIIMA , 0743071148. New balance: UGX 11155.
 *  ID: 42919920590. ..."
 *
 * The sender network named in "from X Money" reflects MTN/Airtel interop
 * and is NOT the same as which SIM/app received the SMS — `network` below
 * should be set by the caller based on which relay listener saw it, not
 * parsed out of this text.
 */
const MTN_RECEIVED_RE = /you have received ugx\s*([\d,]+)\s*from\s*.+?\bon\b.+?reason:\s*([^,]+?)\s*,\s*([\d+]{6,15})\D*new balance.*?\bid:\s*(\d+)/is;
/** Fallback for a Reason field with no phone number captured — some MoMo
 *  app sends carry only free text. reasonPhone becomes null; matching
 *  falls back to name-only. */
const MTN_RECEIVED_NO_PHONE_RE = /you have received ugx\s*([\d,]+)\s*from\s*.+?\bon\b.+?reason:\s*([^.]+?)\.\s*new balance.*?\bid:\s*(\d+)/is;
/**
 * Airtel Money "cash deposit" wording — CONFIRMED against a real SMS:
 * "Cash deposit of UGX 2,000 from sawan distributor 2. Balance UGX 2,000.
 *  Trans ID: 154090078762. Date 16-August-2026 12:10."
 *
 * Note the field-naming differs entirely from MTN's template: "Trans ID:"
 * not "ID:", "Balance UGX" not "New balance: UGX", no "Reason:" field at
 * all — the depositor's name sits directly after "from". No phone number
 * is present in this format, so reasonPhone is always null here; matching
 * falls back to name-only (see reasonMentionsReference).
 *
 * IMPORTANT CAVEAT: this is confirmed for an agent/distributor CASH
 * DEPOSIT, which is the closest real sample available as of this release.
 * A genuine peer-to-peer "customer sent you money" Airtel notification
 * may use a different template — Airtel's own SMS wording is NOT
 * consistent across transaction types (the same phone also received
 * "Quick Loans has collected... TxnID:" and "PAID.TID..." — three
 * different ID field names for three different transaction types). Test
 * this against a real customer-to-you Airtel payment before fully trusting
 * it in production; until then, anything that doesn't match falls through
 * to parse_failed and is logged for manual review rather than silently
 * dropped or mis-parsed.
 */
const AIRTEL_CASH_DEPOSIT_RE = /cash deposit of ugx\s*([\d,]+)\s*from\s+(.+?)\.\s*balance ugx\s*[\d,]+\.\s*trans id:\s*(\w+)/is;
/**
 * Speculative fallback matching MTN's phrasing convention ("you have
 * received ugx... from NAME PHONE... txid: X") in case some Airtel
 * account configurations or app versions use that shape instead of the
 * "Cash deposit" wording above. UNCONFIRMED against any real sample —
 * kept only as a second-chance pattern, tried after the confirmed one.
 */
const AIRTEL_RECEIVED_FALLBACK_RE = /you have received ugx\s*([\d,]+).+?from\s+([a-z\s]+?)[\s.]+(\d{6,15}).*?txid[:\s]*(\w+)/is;
function parseMomoSms(rawBody, network) {
    const text = rawBody.replace(/\s+/g, " ").trim();
    const mtnMatch = text.match(MTN_RECEIVED_RE);
    if (mtnMatch) {
        return {
            network,
            amountUgx: parseInt(mtnMatch[1].replace(/,/g, ""), 10),
            reasonName: mtnMatch[2].trim(),
            reasonPhone: mtnMatch[3].trim(),
            transactionId: mtnMatch[4].trim(),
        };
    }
    const mtnNoPhone = text.match(MTN_RECEIVED_NO_PHONE_RE);
    if (mtnNoPhone) {
        return {
            network,
            amountUgx: parseInt(mtnNoPhone[1].replace(/,/g, ""), 10),
            reasonName: mtnNoPhone[2].trim(),
            reasonPhone: null,
            transactionId: mtnNoPhone[3].trim(),
        };
    }
    const airtelDeposit = text.match(AIRTEL_CASH_DEPOSIT_RE);
    if (airtelDeposit) {
        return {
            network,
            amountUgx: parseInt(airtelDeposit[1].replace(/,/g, ""), 10),
            reasonName: airtelDeposit[2].trim(),
            reasonPhone: null,
            transactionId: airtelDeposit[3].trim(),
        };
    }
    const airtelFallback = text.match(AIRTEL_RECEIVED_FALLBACK_RE);
    if (airtelFallback) {
        return {
            network,
            amountUgx: parseInt(airtelFallback[1].replace(/,/g, ""), 10),
            reasonName: airtelFallback[2].trim(),
            reasonPhone: airtelFallback[3].trim(),
            transactionId: airtelFallback[4].trim(),
        };
    }
    return null;
}
/** Loose match: strips punctuation/case so "Cisdatabun" matches "CISDATABUN ." etc. */
function normaliseForMatch(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
/**
 * Loose substring match by design — MoMo payers often abbreviate or
 * mistype the reference they were told to type. A minimum length guard
 * exists specifically to avoid the false-positive case this looseness
 * otherwise invites: a short referenceText (a 2-3 char business
 * abbreviation, say) would substring-match almost any payer name that
 * happens to contain those characters in sequence. Below the threshold,
 * require an exact normalised match instead of substring containment.
 */
const MIN_LENGTH_FOR_SUBSTRING_MATCH = 4;
function reasonMentionsReference(reasonName, referenceText) {
    const reason = normaliseForMatch(reasonName);
    const reference = normaliseForMatch(referenceText);
    if (reference.length === 0)
        return false;
    // Guard on the SHORTER of the two strings, not both — a short
    // referenceText substring-matching inside an unrelated long reasonName
    // (e.g. "Jo" inside "John Okello") is exactly the false positive this
    // exists to prevent; a short reasonName against a long referenceText has
    // the same risk in the other direction. Below the threshold, require an
    // exact normalised match instead of substring containment.
    if (Math.min(reason.length, reference.length) < MIN_LENGTH_FOR_SUBSTRING_MATCH) {
        return reason === reference;
    }
    return reason.includes(reference) || reference.includes(reason);
}
