import { SignIn } from "@clerk/nextjs";
export default function SignInPage() {
  return (
    <main className="login">
      <a href="/" className="brand">
        ✧ LIFE RPG
      </a>
      <section className="panel">
        <span className="eyebrow">WELCOME HOME, TRAVELER</span>
        <h1>모험의 서 열기</h1>
        <p>지정된 이메일로 인증 코드를 받아 로그인하세요.</p>
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <SignIn routing="path" path="/sign-in" forceRedirectUrl="/" />
        ) : (
          <p className="status-note">
            아직 로그인 서비스가 연결되지 않았습니다. 실제 캐릭터와 기록은
            조회할 수 없습니다.
          </p>
        )}
        <a className="text-link" href="/demo">
          합성 화면 둘러보기 ↗
        </a>
      </section>
    </main>
  );
}
