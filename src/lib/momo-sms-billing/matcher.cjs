"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normaliseForMatch = exports.reasonMentionsReference = exports.parseMomoSms = void 0;
exports.processInboundMomoSms = processInboundMomoSms;
const parser_1 = require("./parser.cjs");
/**
 * End-to-end: parse -> reserve (dedup) -> match -> callback.
 *
 * Every branch is reported through StorageAdapter so nothing this sees is
 * ever silently dropped — "no_match" / "ambiguous" / "parse_failed" all
 * need a human eventually; only "matched" fires onPaymentMatched.
 *
 * IMPORTANT — the dedup reservation happens BEFORE matching, not after.
 * If it happened after (parse -> check-if-seen -> match -> approve ->
 * THEN record), two near-simultaneous calls for the same SMS (a phone-side
 * retry racing the original) could both pass the "not seen yet" check
 * before either had recorded anything, and both would go on to call
 * onPaymentMatched — double-crediting the same payment. Reserving first,
 * with your StorageAdapter's unique-constrained insert as the real guard,
 * closes that window.
 */
async function processInboundMomoSms(rawBody, network, storage) {
    const parsed = (0, parser_1.parseMomoSms)(rawBody, network);
    if (!parsed) {
        await storage.recordParseFailure(rawBody, network);
        return { status: "parse_failed" };
    }
    const reservation = await storage.reserveEvent({
        rawBody,
        network,
        transactionId: parsed.transactionId,
        parsedAmountUgx: parsed.amountUgx,
        parsedReasonName: parsed.reasonName,
        parsedReasonPhone: parsed.reasonPhone,
    });
    if (!reservation.reserved) {
        return { status: "duplicate", existingEventId: reservation.existingEventId };
    }
    const { eventId } = reservation;
    const candidates = await storage.findPendingPaymentsByAmount(parsed.amountUgx);
    const matching = candidates.filter((p) => (0, parser_1.reasonMentionsReference)(parsed.reasonName, p.referenceText));
    if (matching.length === 0) {
        await storage.updateEventStatus(eventId, {
            status: candidates.length === 0 ? "no_match" : "ambiguous",
            note: candidates.length === 0
                ? undefined
                : `${candidates.length} pending payment(s) at this amount, none matched Reason text "${parsed.reasonName}"`,
        });
        return candidates.length === 0
            ? { status: "no_match" }
            : { status: "ambiguous", candidateIds: candidates.map((c) => c.id) };
    }
    if (matching.length > 1) {
        await storage.updateEventStatus(eventId, {
            status: "ambiguous",
            note: `Reason "${parsed.reasonName}" matched ${matching.length} pending payments at this amount: ${matching
                .map((p) => p.referenceText)
                .join(", ")}`,
        });
        return { status: "ambiguous", candidateIds: matching.map((p) => p.id) };
    }
    const payment = matching[0];
    // The event is already reserved (dedup-safe) — if your callback throws,
    // this SMS will NOT be silently retried as a duplicate, but it also
    // won't be marked "matched." Decide your own alerting for that case;
    // this library doesn't guess at retry semantics for your billing logic.
    await storage.onPaymentMatched(payment, parsed);
    await storage.updateEventStatus(eventId, {
        status: "matched",
        matchedPaymentId: payment.id,
    });
    return { status: "matched", paymentId: payment.id };
}
var parser_2 = require("./parser.cjs");
Object.defineProperty(exports, "parseMomoSms", { enumerable: true, get: function () { return parser_2.parseMomoSms; } });
Object.defineProperty(exports, "reasonMentionsReference", { enumerable: true, get: function () { return parser_2.reasonMentionsReference; } });
Object.defineProperty(exports, "normaliseForMatch", { enumerable: true, get: function () { return parser_2.normaliseForMatch; } });
__exportStar(require("./types.cjs"), exports);
