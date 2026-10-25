import type {Metadata} from 'next';
import RevenueApp from '@/components/revenue/revenue-app';
import './revenue.css';

export const metadata: Metadata = {title: 'Onixus Revenue'};

export default function Page() { return <RevenueApp/>; }
