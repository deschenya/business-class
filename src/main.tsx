import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';
import { useStore } from './store';

// доступ к состоянию из консоли браузера (отладка и автотесты)
(window as any).bk = useStore;

createRoot(document.getElementById('root')!).render(<App />);
