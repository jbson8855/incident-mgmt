'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

export function useAdminSession() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  function refresh() {
    fetch('/api/admin/session')
      .then((res) => res.json())
      .then((data: { isAdmin: boolean }) => setIsAdmin(data.isAdmin));
  }

  useEffect(refresh, []);

  return { isAdmin, refresh };
}

export function AdminSessionBar({ isAdmin, onChange }: { isAdmin: boolean | null; onChange: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  async function login() {
    setLoggingIn(true);
    setError(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoggingIn(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? '로그인에 실패했습니다.');
      return;
    }
    setPassword('');
    onChange();
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    onChange();
  }

  if (isAdmin === null) return null;

  if (isAdmin) {
    return (
      <div className="mb-4 flex items-center justify-between text-xs text-[#999] bg-gray-50 border border-[#eee] rounded-md px-3 py-2">
        <span>관리자 모드 — 수정할 수 있습니다.</span>
        <button type="button" onClick={logout} className="text-[#666] hover:text-[#0a0a0a] underline">
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
      <span className="text-yellow-800">보기 전용입니다. 관리자 비밀번호를 입력하면 수정할 수 있습니다.</span>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') login();
        }}
        placeholder="관리자 비밀번호"
        className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1 outline-none focus:border-[#999]"
      />
      <Button size="sm" onClick={login} disabled={loggingIn}>
        {loggingIn ? '확인 중...' : '로그인'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
