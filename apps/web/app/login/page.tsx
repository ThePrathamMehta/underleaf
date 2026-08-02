import { Suspense } from "react";
import { AuthForm } from "../../components/auth-form";

export const metadata = { title: "Sign in · Underleaf" };

export default function LoginPage() {
  return (
    // AuthForm reads useSearchParams for the post-login redirect, which requires
    // a Suspense boundary during prerendering.
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
