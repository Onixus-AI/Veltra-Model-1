import React from 'react';
import {createRoot} from 'react-dom/client';
import VeltraWorkspace from '../../components/veltra-workspace';
import '../../app/globals.css';
import '../../styles/workspace.css';
import '../../styles/veltra-theme.css';
import '../../styles/spatial-workspace.css';
createRoot(document.getElementById('root')!).render(<VeltraWorkspace/>);
