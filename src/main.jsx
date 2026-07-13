import React from 'react';
import { createRoot } from 'react-dom/client';
import LedScheduleBoard from './components/LedScheduleBoard.jsx';
import SchedulerApp from './components/SchedulerApp.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  window.location.pathname === '/entrance-led' ? <LedScheduleBoard /> : <SchedulerApp />,
);
