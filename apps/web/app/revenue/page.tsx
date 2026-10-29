import type {Metadata} from 'next';
import RevenueApp from '@/components/revenue/revenue-app';
import './revenue.css';

export const metadata: Metadata = {title: 'Sales & operations | Onixus Workspace'};

export default function Page() { return <RevenueApp/>; }
