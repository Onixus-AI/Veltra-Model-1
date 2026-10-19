import VeltraWorkspace from "@/components/veltra-workspace";
import WorkspaceHome from "./workspace/page";

export default async function HomePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const query=await searchParams;
 const openChat=query.view==='chat'||Boolean(query.canvas||query.crm_workspace||query.crm_customer);
 return openChat?<VeltraWorkspace/>:<WorkspaceHome/>;
}
