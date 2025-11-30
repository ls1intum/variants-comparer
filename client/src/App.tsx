import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { SiteHeader } from '@/components/site-header';
import ComparePage from '@/pages/ComparePage';
import ConfigurePage from '@/pages/ConfigurePage';
import StatsPage from '@/pages/StatsPage';
import { ExerciseProvider } from '@/contexts/ExerciseContext';
import { ToastProvider } from '@/contexts/ToastContext';

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ExerciseProvider>
          <div className="min-h-screen bg-muted/40">
            <SiteHeader />
            <main className="mx-auto flex w-full max-w-[95vw] flex-col gap-6 px-6 py-10">
              <Routes>
                <Route path="/" element={<ConfigurePage />} />
                <Route path="/compare" element={<ComparePage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </ExerciseProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
