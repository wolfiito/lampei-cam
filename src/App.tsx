import { HomePage } from './pages/HomePage';
import { ReceiverPage } from './pages/ReceiverPage';
import { SenderPage } from './pages/SenderPage';

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';

  if (path === '/sender') {
    return <SenderPage />;
  }

  if (path === '/receiver') {
    return <ReceiverPage />;
  }

  return <HomePage />;
}

