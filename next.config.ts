import type { NextConfig } from "next";
import os from "os";

function getLanOrigins(): string[] {
  const origins = new Set<string>();
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        origins.add(addr.address);
        origins.add(`${addr.address.split(".").slice(0, 3).join(".")}.*`);
      }
    }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // ngrok 등으로 외부 공개하거나 같은 네트워크의 다른 단말에서 접속할 때,
  // dev 서버가 localhost가 아닌 Origin의 요청(정적 자산/API 호출)을 차단하는 걸
  // 막기 위해 허용 도메인을 등록한다. 이 PC의 내부망 IP/대역을 실행 시점에
  // 자동으로 감지하므로 기기를 옮겨도 수정할 필요 없다.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.app",
    "*.ngrok.io",
    ...getLanOrigins(),
  ],
};

export default nextConfig;
