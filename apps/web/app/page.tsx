import AuthGate from "@/components/auth-gate";
import VeltraWorkspace from "@/components/veltra-workspace";

export default function HomePage() {
  return (
    <AuthGate>
      <VeltraWorkspace />
    </AuthGate>
  );
}
