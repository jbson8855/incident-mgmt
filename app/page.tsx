import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-2">시작하세요</h1>
      <p className="text-sm text-[#555] mb-8">
        이 파일(<code className="font-mono text-xs bg-[#eee] px-1 py-0.5 rounded">app/page.tsx</code>)을 수정해서 첫 번째 페이지를 만들어보세요.
      </p>

      <div className="space-y-6">
        <Card title="UI 컴포넌트">
          <div className="space-y-4">
            <div>
              <div className="text-xs text-[#999] mb-2">Button</div>
              <div className="flex gap-2 flex-wrap">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
              </div>
            </div>
            <div>
              <div className="text-xs text-[#999] mb-2">Badge</div>
              <div className="flex gap-2 flex-wrap">
                <Badge color="gray">gray</Badge>
                <Badge color="green">green</Badge>
                <Badge color="yellow">yellow</Badge>
                <Badge color="red">red</Badge>
                <Badge color="blue">blue</Badge>
              </div>
            </div>
          </div>
        </Card>

        <Card title="다음 단계">
          <ol className="text-sm text-[#333] space-y-2 list-decimal list-inside">
            <li><code className="font-mono text-xs bg-[#eee] px-1 rounded">schema.sql</code>에 테이블을 추가한다</li>
            <li><code className="font-mono text-xs bg-[#eee] px-1 rounded">app/api/[route]/route.ts</code>에 API를 만든다</li>
            <li><code className="font-mono text-xs bg-[#eee] px-1 rounded">app/[page]/page.tsx</code>에 화면을 만든다</li>
            <li>사이드바 <code className="font-mono text-xs bg-[#eee] px-1 rounded">layout.tsx</code>에 nav 항목을 추가한다</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
