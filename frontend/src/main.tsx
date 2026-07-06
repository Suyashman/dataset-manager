import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import App from "./App.tsx";
import "./index.css";

const queryClient = new QueryClient({
  // networkMode: 'always' skips React Query's browser online/offline detection entirely. This
  // app only ever talks to localhost, so "offline" isn't a meaningful state for it — but if the
  // browser's online detection ever misfires (observed during QA testing: navigator.onLine true,
  // yet a query got stuck in fetchStatus 'paused' indefinitely), the default 'online' mode would
  // hang a failed request forever instead of ever settling into an error state the UI can show.
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, networkMode: "always" } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster richColors position="bottom-right" />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
