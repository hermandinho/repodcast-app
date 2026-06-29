import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center px-4 py-12">
      <SignIn />
    </div>
  );
}
