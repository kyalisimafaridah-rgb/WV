"use strict";
/**
 * momo-sms-billing — public types.
 *
 * This library is deliberately storage-agnostic: it doesn't know or care
 * whether you're on Postgres, MySQL, SQLite, or a spreadsheet with a REST
 * front-end. You implement StorageAdapter against whatever you already
 * use; the library just needs those five operations done atomically where
 * marked.
 */
Object.defineProperty(exports, "__esModule", { value: true });
