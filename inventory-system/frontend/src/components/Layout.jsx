import { useState, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import EmbeddedBar from './EmbeddedBar';
import api from '../api/axios';

const isEmbedded = () => new URLSearchParams(window.location.search).get('embedded') === '1';

function useLowStockAlert() {
  const hasLowStock = useRef(false);
  const soundPlayed = useRef(false);

  useEffect(() => {
    const checkLowStock = async () => {
      try {
        const { data } = await api.get('/reports/low-stock');
        hasLowStock.current = data?.length > 0;
      } catch (_) {}
    };

    // Play sound directly inside click handler - this is the ONLY way
    // browsers allow audio to play (AudioContext must be created in user gesture)
    const onClick = () => {
      if (hasLowStock.current && !soundPlayed.current) {
        soundPlayed.current = true;
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const now = ctx.currentTime;

          [
            [880, 0, 0.15],
            [880, 0.25, 0.15],
            [660, 0.5, 0.3],
          ].forEach(([freq, start, dur]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.value = 0.25;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + start);
            osc.stop(now + start + dur);
          });

          setTimeout(() => ctx.close(), 2000);
        } catch (_) {}
      }
    };

    document.addEventListener('click', onClick);
    checkLowStock();

    const interval = setInterval(() => {
      soundPlayed.current = false;
      checkLowStock();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      document.removeEventListener('click', onClick);
    };
  }, []);
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const embedded = isEmbedded();

  useLowStockAlert();

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  if (embedded) {
    return (
      <div dir="rtl" className="flex flex-col min-h-screen bg-gray-50 font-sans">
        <EmbeddedBar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Header */}
        <Header onToggleSidebar={toggleSidebar} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
