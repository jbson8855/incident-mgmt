import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // ngrok 등으로 외부 공개하거나 같은 네트워크의 다른 단말에서 접속할 때,
  // dev 서버가 localhost가 아닌 Origin의 요청(정적 자산/API 호출)을 차단하는 걸
  // 막기 위해 허용 도메인을 등록한다. 실제 ngrok 주소로 바뀌면 여기 패턴에 맞춰 수정.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.app",
    "*.ngrok.io",
    "192.168.145.188", // 이 PC의 내부망 IP — 다른 단말에서 접속 시 필요
    "192.168.145.*", // 같은 대역의 다른 단말에서 접속할 경우 대비
  ],
};

export default nextConfig;
