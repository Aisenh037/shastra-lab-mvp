import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";
import Refunds from "./pages/legal/Refunds";
import Delivery from "./pages/legal/Delivery";
import Contact from "./pages/legal/Contact";
import About from "./pages/legal/About";
import Dashboard from "./pages/Dashboard";
import Syllabi from "./pages/Syllabi";
import Analyze from "./pages/Analyze";
import BatchAnalyze from "./pages/BatchAnalyze";
import PaperComparison from "./pages/PaperComparison";
import YearOverYear from "./pages/YearOverYear";
import WrittenPractice from "./pages/WrittenPractice";
import MockTest from "./pages/MockTest";
import Leaderboard from "./pages/Leaderboard";
import Achievements from "./pages/Achievements";
import Questions from "./pages/Questions";
import Reports from "./pages/Reports";
import SubmissionHistory from "./pages/SubmissionHistory";
import NotFound from "./pages/NotFound";
import { features } from "@/config/features";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/refunds" element={<Refunds />} />
              <Route path="/delivery" element={<Delivery />} />
              <Route path="/shipping" element={<Delivery />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/about" element={<About />} />
              <Route path="/pricing" element={<About />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/syllabi" element={<Syllabi />} />
              <Route path="/analyze" element={<Analyze />} />
              <Route path="/batch-analyze" element={<BatchAnalyze />} />
              <Route path="/compare" element={<PaperComparison />} />
              <Route path="/year-over-year" element={<YearOverYear />} />
              <Route path="/written-practice" element={<WrittenPractice />} />
              <Route path="/mock-test" element={<MockTest />} />
              {features.leaderboard && <Route path="/leaderboard" element={<Leaderboard />} />}
              <Route path="/achievements" element={<Achievements />} />
              <Route path="/questions" element={<Questions />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/submission-history" element={<SubmissionHistory />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
