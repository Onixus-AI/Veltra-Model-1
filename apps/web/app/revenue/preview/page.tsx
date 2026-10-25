import type {Metadata} from 'next';
import RevenueApp from '@/components/revenue/revenue-app';
import '../revenue.css';

export const metadata: Metadata = {title: 'Onixus Revenue — preview', robots: {index: false}};

export default function Page() { return <RevenueApp preview/>; }
