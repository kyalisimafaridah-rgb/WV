import dns from 'dns/promises';
import net from 'net';

const PRIVATE_IPV4 = [
  ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
];
function ipv4ToInt(ip) { return ip.split('.').reduce((n, octet) => (n * 256) + Number(octet), 0) >>> 0; }
function isPrivateIpv4(ip) { const value=ipv4ToInt(ip); return PRIVATE_IPV4.some(([base,bits])=>{const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0; return (value&mask)===(ipv4ToInt(base)&mask);}); }
function isPrivateIpv6(ip) { const normalized=ip.toLowerCase().replace(/^\[|\]$/g,''); if(normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7)); return normalized==='::'||normalized==='::1'||normalized.startsWith('fc')||normalized.startsWith('fd')||normalized.startsWith('fe8')||normalized.startsWith('fe9')||normalized.startsWith('fea')||normalized.startsWith('feb')||normalized.startsWith('ff'); }
export function isPrivateAddress(address) { const family=net.isIP(address); if(family===4)return isPrivateIpv4(address); if(family===6)return isPrivateIpv6(address); return true; }
export async function resolveRouterTarget(host) { const value=String(host||'').trim(); if(!value||value.length>255||/[\s/:]/.test(value)) throw new Error('Router host must be an IP address or hostname, without a URL scheme or path'); const addresses=net.isIP(value)?[{address:value,family:net.isIP(value)}]:await dns.lookup(value,{all:true,verbatim:true}); if(!addresses.length)throw new Error('Router host could not be resolved'); const allowPrivate=process.env.ALLOW_PRIVATE_ROUTER_HOSTS==='true'; const publicAddress=addresses.find(({address})=>!isPrivateAddress(address)); if(!allowPrivate&&!publicAddress)throw new Error('Router host resolves to a private or local network address, which is blocked for security'); return publicAddress?.address||addresses[0].address; }
