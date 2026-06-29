import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center px-4 py-12">
      <SignUp />
    </div>
  );
}
