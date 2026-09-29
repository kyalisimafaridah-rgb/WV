import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress } from '../src/utils/network.js';
test('blocks private IPv4 ranges',()=>{for(const ip of ['10.0.0.1','100.64.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.168.1.1']) assert.equal(isPrivateAddress(ip),true,ip);});
test('allows ordinary public IPv4',()=>{assert.equal(isPrivateAddress('41.90.1.1'),false);});
test('blocks local IPv6 ranges',()=>{for(const ip of ['::1','fc00::1','fd12:3456::1','fe80::1']) assert.equal(isPrivateAddress(ip),true,ip);});
