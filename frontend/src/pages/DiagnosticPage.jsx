import AppShell from "../components/layout/AppShell";
import ThreeScene from "../components/three/ThreeScene";
import DiagnosticPanel from "../components/ui/DiagnosticPanel";
import CameraView from "../components/camera/CameraView";

function DiagnosticPage() {
  return (
    <AppShell>
      <main className="diagnostic-page">
        <ThreeScene />
        <DiagnosticPanel />
        <CameraView />
      </main>
    </AppShell>
  );
}

export default DiagnosticPage;