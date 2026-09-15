import { isIP, BlockList } from "node:net";
const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  blocked.addSubnet(ip, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2001::", 32],
])
  blocked.addSubnet(ip, bits, "ipv6");
export function publicAddress(ip) {
  const kind = isIP(ip);
  return kind === 4
    ? !blocked.check(ip, "ipv4")
    : kind === 6 && global6.check(ip, "ipv6") && !blocked.check(ip, "ipv6");
}
export function publicURL(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".localhost") ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".internal")
  )
    throw Error("只允许公开 HTTPS 来源");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !publicAddress(host)) throw Error("不能读取本机或私网地址");
  return u;
}
