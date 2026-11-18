import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';
import { useStore, __simulateDrop, __hostPeer } from './store';

// доступ к состоянию из консоли браузера (отладка и автотесты)
(window as any).bk = useStore;
(window as any).bkDrop = __simulateDrop;
(window as any).bkHostPeer = __hostPeer;

createRoot(document.getElementById('root')!).render(<App />);
