import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    try {
        const { admin, session } = await authenticate.admin(request);

        const syncStatus = await prisma.SyncStatus.findMany();

        if (syncStatus.length === 0) {
            const newSyncStatus = await prisma.SyncStatus.create({
                data: {
                    isProductImportProcessing: false,
                }
            });
            console.log("Created new sync status:", newSyncStatus);
            syncStatus.push(newSyncStatus);
        }

        return new Response(JSON.stringify(syncStatus), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Error while fetching data in getSyncStatus:", error);
        return new Response(JSON.stringify({ message: "Error while fetching data in getSyncStatus", error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
