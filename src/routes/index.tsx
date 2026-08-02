import { createFileRoute } from "@tanstack/react-router";
import { AnalyzerApp } from "@/components/analyzer-app";
import { TermsGate } from "@/components/terms-gate";
import { I18nProvider } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <I18nProvider>
      <TermsGate>
        <AnalyzerApp />
      </TermsGate>
    </I18nProvider>
  );
}
