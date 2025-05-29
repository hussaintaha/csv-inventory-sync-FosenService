import csvParser from "csv-parser";
// import path from "path";
// import fs from "fs";
// import { PassThrough } from "stream";
import { finished } from "stream/promises";
import { graphqlRequest } from "../component/graphqlRequest";
import { Readable } from "stream";
import Client from "ssh2-sftp-client";
import prisma from "../db.server";

const {
    SFTP_HOST,
    SFTP_PORT,
    SFTP_USER,
    SFTP_PASSWORD,
    SFTP_REMOTE_FILE_PATH
} = process.env;
const sftp = new Client();

// parseCSV from local
// async function parseCsv(filePath) {
//     const results = [];

//     // const file = fs.readFileSync(filePath, "utf8");
//     // const lines = file.split(/\r\n|\n/);
//     // console.log("Total lines in file:", lines.length);
//     // live store products sku: AV1645501,MI567465
//     const parser = fs
//         .createReadStream(filePath)
//         .pipe(csvParser({
//             separator: ";",
//             headers: false,
//             quote: "",        // disabling quotes
//             skipComments: false,
//             strict: false
//         }));

//     parser.on("data", row => results.push(row));
//     await finished(parser);
//     console.log("Parsed records:", results.length);
//     return results.map(r => ({ sku: r[2], qty: r[3] }));
// }

async function parseCsvFromSftp() {
    try {
        await sftp.connect({
            host: SFTP_HOST,
            port: SFTP_PORT,
            username: SFTP_USER,
            password: SFTP_PASSWORD,
        });

        const fileBuffer = await sftp.get(SFTP_REMOTE_FILE_PATH);
        const readableStream = Readable.from(fileBuffer.toString());

        const results = [];

        await new Promise((resolve, reject) => {
            readableStream
                .pipe(
                    csvParser({
                        separator: ";",
                        headers: false,
                        quote: "",
                        skipComments: false,
                        strict: false,
                    })
                )
                .on("data", (row) => results.push(row))
                .on("end", resolve)
                .on("error", reject);
        });

        console.log("Parsed records:", results.length);

        return results.map((r) => ({ sku: r[2], qty: r[3] }));
    } catch (error) {
        console.error("Error reading CSV from SFTP:", error);
        return [];
    } finally {
        await sftp.end();
    }
}


export const loader = async ({ request }) => {
    try {
        const shopData = await prisma.session.findMany();
        // const shopData = [{
        //     shop: "mjfdah-nh.myshopify.com",
        //     accessToken: process.env.SHOPIFY_ACCESS_TOKEN
        // }]
        console.log('shopData===================>', shopData);
        if (!shopData.length) return { message: "No shop data found." };

        const parseResults = await parseCsvFromSftp();

        const skuMap = parseResults.reduce((map, row) => {
            const qty = parseInt(row.qty, 10) || 0;
            map[row.sku] = (map[row.sku] || 0) + qty;
            return map;
        }, {});

        // const filePath = path.join(
        //     process.cwd(),
        //     "public",
        //     "csv",
        //     "variantSKU.csv"
        // );

        // return { parseResults, skuMap: Object.entries(skuMap) }

        console.log("parseResults length:", parseResults.length, "  skuMap length:", Object.entries(skuMap).length)

        let count = 0;
        for (const [sku, qty] of Object.entries(skuMap)) {
            count++
            const IS_LOG = count % 500 === 0
            const productSKUQuery = `
                query ProductVariantsList {
                    productVariants(first: 10, query: "sku:${sku}") {
                        nodes {
                            id
                            title
                            inventoryQuantity
                            inventoryItem {
                                id
                                inventoryLevels(first: 10) {
                                    edges {
                                        node {
                                            id
                                            location {
                                                id
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        pageInfo {
                            startCursor
                            endCursor
                        }
                    }
                }
            `;

            const dataOfProductSKU = await graphqlRequest(shopData, productSKUQuery);
            // console.log("data=================>", dataOfProductSKU);
            if (IS_LOG) console.log("dataOfProductSKU=================>", dataOfProductSKU.data.productVariants.nodes.length);
            if (IS_LOG) console.log("count----->", count);

            if (dataOfProductSKU.data.productVariants.nodes.length == 1) {
                const inventoryItemID = dataOfProductSKU.data.productVariants.nodes[0].inventoryItem.id;
                const inventoryLevels = dataOfProductSKU.data.productVariants.nodes[0].inventoryItem.inventoryLevels.edges;
                if (inventoryLevels.length) {
                    const locationID = inventoryLevels[0].node.location.id;
                    const delta = qty - dataOfProductSKU.data.productVariants.nodes[0].inventoryQuantity;
                    if (IS_LOG) console.log("inventoryItemID=================>", inventoryItemID);
                    if (IS_LOG) console.log("locationID=================>", locationID);
                    if (IS_LOG) console.log("delta=================>", delta);
                    if (delta) {
                        if (IS_LOG) console.log("Delta is not zero, updating inventory of sku...", sku);
                    } else {
                        if (IS_LOG) console.log("Delta is zero, no need to update inventory of sku....", sku);
                    }


                    if (locationID) {

                        const inventoryAdjustmentMutation = `
                        mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
                            inventoryAdjustQuantities(input: $input) {
                                userErrors {
                                    field
                                    message
                                }
                                inventoryAdjustmentGroup {
                                    createdAt
                                    reason
                                    changes {
                                        name
                                        delta
                                    }
                                }
                            }
                        }
                    `;

                        await graphqlRequest(shopData, inventoryAdjustmentMutation, {
                            variables: {
                                input: {
                                    reason: "correction",
                                    name: "available",
                                    changes: [
                                        {
                                            delta,
                                            inventoryItemId: inventoryItemID,
                                            locationId: locationID
                                        }
                                    ]
                                }
                            }
                        });
                    }
                } else {
                    console.warn(`No inventoryLevels found for SKU: ${sku}`);
                }

            } else if (dataOfProductSKU.data.productVariants.nodes.length > 1) {
                if (IS_LOG) console.log("Multiple variants found hence not updating quantity for SKU:", sku);
            } else {
                if (IS_LOG) console.log("No variant found for SKU:", sku);
            }
        }
        console.log(`All SKUs have been processed successfully from the SFTP server CSV file! [${new Date().toLocaleString()}]`);

        return { success: true };
    } catch (error) {
        console.error("error reading CSV from api.syncProducts:", error);
        return new Response(
            JSON.stringify({ error: error, message: "error reading CSV from api.syncProducts" }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};














































//////////////////////////////////////// old code




// import csvParser from "csv-parser";
// import path from "path";
// import fs from "fs";
// import { finished } from "stream/promises";
// import { graphqlRequest } from "../component/graphqlRequest";
// import prisma from "../db.server";

// async function parseCsv(filePath) {
//     const results = [];

//     // const file = fs.readFileSync(filePath, "utf8");
//     // const lines = file.split(/\r\n|\n/);
//     // console.log("Total lines in file:", lines.length);
//     // live store products sku: AV1645501,MI567465
//     const parser = fs
//         .createReadStream(filePath)
//         .pipe(csvParser({
//             separator: ";",
//             headers: false,
//             quote: "",        // disabling quotes
//             skipComments: false,
//             strict: false
//         }));

//     parser.on("data", row => results.push(row));
//     await finished(parser);
//     console.log("Parsed records:", results.length);
//     return results.map(r => ({ sku: r[2], qty: r[3] }));
// }

// export const loader = async ({ request }) => {
//     try {
//         const shopData = await prisma.session.findMany();
//         console.log('shopData===================>', shopData);
//         if (!shopData.length) return json({ message: "No shop data found." });
//         const filePath = path.join(
//             process.cwd(),
//             "public",
//             "csv",
//             "variantSKU.csv"
//         );
//         const results = await parseCsv(filePath);
//         const skuMap = results.reduce((map, row) => {
//             const qty = parseInt(row.qty, 10) || 0;
//             if (!map[row.sku]) {
//                 map[row.sku] = { ...row, qty };
//             } else {
//                 map[row.sku].qty += qty;
//             }
//             return map;
//         }, {});

//         const consolidatedData = Object.values(skuMap);

//         for (const data of consolidatedData) {
//             const productSKUQuery = `
//                 query ProductVariantsList {
//                     productVariants(first: 10, query: "sku:${data?.sku}") {
//                         nodes {
//                             id
//                             title
//                             inventoryQuantity
//                             inventoryItem {
//                                 id
//                                 inventoryLevels(first: 10) {
//                                     edges {
//                                         node {
//                                             id
//                                             location {
//                                                 id
//                                             }
//                                         }
//                                     }
//                                 }
//                             }
//                         }
//                         pageInfo {
//                             startCursor
//                             endCursor
//                         }
//                     }
//                 }
//             `;

//             const dataOfProductSKU = await graphqlRequest(shopData, productSKUQuery);
//             console.log("data=================>", data);
//             console.log("dataOfProductSKU=================>", dataOfProductSKU.data.productVariants.nodes.length);

//             if (dataOfProductSKU.data.productVariants.nodes.length == 1) {
//                 const inventoryItemID = dataOfProductSKU.data.productVariants.nodes[0].inventoryItem.id;
//                 const locationID = dataOfProductSKU.data.productVariants.nodes[0].inventoryItem.inventoryLevels.edges[0].node.location.id;
//                 const delta = data.qty - dataOfProductSKU.data.productVariants.nodes[0].inventoryQuantity;
//                 console.log("inventoryItemID=================>", inventoryItemID);
//                 console.log("locationID=================>", locationID);
//                 console.log("delta=================>", delta);
//                 if (delta) {
//                     console.log("Delta is not zero, updating inventory...");
//                 } else {
//                     console.log("Delta is zero, no need to update inventory.");
//                 }                

//                 if (locationID) {

//                     const inventoryAdjustmentMutation = `
//                         mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
//                             inventoryAdjustQuantities(input: $input) {
//                                 userErrors {
//                                     field
//                                     message
//                                 }
//                                 inventoryAdjustmentGroup {
//                                     createdAt
//                                     reason
//                                     changes {
//                                         name
//                                         delta
//                                     }
//                                 }
//                             }
//                         }
//                     `;

//                     await graphqlRequest(shopData, inventoryAdjustmentMutation, {
//                         variables: {
//                             input: {
//                                 reason: "correction",
//                                 name: "available",
//                                 changes: [
//                                     {
//                                         delta,
//                                         inventoryItemId: inventoryItemID,
//                                         locationId: locationID
//                                     }
//                                 ]
//                             }
//                         }
//                     });
//                 }
//             } else if (dataOfProductSKU.data.productVariants.nodes.length > 1) {
//                 console.log("Multiple variants found hence not updating quantity for SKU:", data.sku);
//             } else {
//                 console.log("No variant found for SKU:", data.sku);
//             }
//         }
//         // console.log("CSV parsed:", results);
//         return { consolidatedData, results };
//     } catch (error) {
//         console.error("error reading CSV:", error);
//         return { error: error.message }, { status: 500 };
//     }
// };
