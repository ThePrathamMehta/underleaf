import { Suspense } from "react";
import { AuthForm } from "../../components/auth-form";

export const metadata = { title: "Create your account · Underleaf" };

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
