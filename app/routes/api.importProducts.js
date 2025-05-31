import csvParser from "csv-parser";
import { Readable } from "stream";
import Client from "ssh2-sftp-client";
import prisma from "../db.server";
import fs from "fs";
import path from "path";
import { finished } from "stream/promises";
import { graphqlRequest } from "../component/graphqlRequest";

const {
    SFTP_HOST,
    SFTP_PORT,
    SFTP_USER,
    SFTP_PASSWORD,
    SFTP_REMOTE_IMPORT_PRODUCT_FILE_PATH
} = process.env;

const sftp = new Client();

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseCsvFromSftp({ category }) {
    if (!SFTP_HOST || !SFTP_PORT || !SFTP_USER || !SFTP_PASSWORD || !SFTP_REMOTE_IMPORT_PRODUCT_FILE_PATH) {
        throw new Error("Missing SFTP configuration environment variables.");
    }
    if (!category) {
        throw new Error("Category is required.");
    }
    console.log("Connecting to SFTP server...");
    try {
        await sftp.connect({
            host: SFTP_HOST,
            port: SFTP_PORT,
            username: SFTP_USER,
            password: SFTP_PASSWORD,
        });

        const fileBuffer = await sftp.get(SFTP_REMOTE_IMPORT_PRODUCT_FILE_PATH);
        const readableStream = Readable.from(fileBuffer.toString());

        const results = [];

        await new Promise((resolve, reject) => {
            readableStream
                .pipe(
                    csvParser({
                        separator: ";",
                        quote: "",
                        skipComments: false,
                        strict: false,
                    })
                )
                .on("data", (row) => {
                    const rowCategory = row["Kategori"];
                    if (
                        category &&
                        rowCategory &&
                        rowCategory?.toLowerCase().trim() === category.toLowerCase().trim()
                    ) {
                        results.push({
                            SKU: row["Varenr."],
                            Category: row["Kategori"],
                            Price: row["Listepris"],
                            Image: row["Bildelenk"],
                            Description: row["Beskrivelse"],
                            ProductTitle: row["Produkt"],
                        });
                    }
                })
                .on("end", resolve)
                .on("error", reject);
        });


        console.log("Parsed records after connection:", results.length);

        // const filtered = results.map((row) => ({
        //     SKU: row["SKU"],
        //     Category: row["Category"],
        //     Price: row["Price"],
        //     Image: row["Image"],
        //     Description: row["Description"],
        //     Produkt: row["ProductTitle"],
        // }));

        // const outputPath = path.join(process.cwd(), "public", "test", "test_filtered_output.csv");
        // const writeStream = fs.createWriteStream(outputPath);
        // writeStream.write("Varenr.,Kategori,Listepris,Bildelenk,Beskrivelse,Produkt\n");

        // for (const item of filtered) {
        //     if (category && item.Category?.toLowerCase() !== category.toLowerCase()) {
        //         continue;
        //     }
        //     console.log(
        //         `SKU: "${item.SKU}", Category: "${item.Category}", Price: "${item.Price}", Image: "${item.Bildelenk}", Description: "${item.Description}", ProductTitle: "${item.ProductTitle}"`
        //     );
        //     // await sleep(1000);
        //     writeStream.write(
        //         `"${item.SKU}","${item.Category}","${item.Price}","${item.Image}","${item.Description}","${item.ProductTitle}"\n`
        //     );
        // }

        // writeStream.end();
        // console.log(`Filtered CSV written to: ${outputPath}`);

        return results;
    } catch (error) {
        console.error("Error reading CSV from SFTP:", error);
        return [];
    } finally {
        await sftp.end();
    }
}

// for local testing only
// const filePath = path.join(
//     process.cwd(),
//     "public",
//     "csv",
//     "Mastertabell-Dekkdetaljer.csv"
// );
// async function parseCsvFromSftp({ category }) {
//     const results = [];

//     if (!fs.existsSync(filePath)) {
//         throw new Error(`File not found: ${filePath}`);
//     }
//     const parser = fs
//         .createReadStream(filePath)
//         .pipe(csvParser({
//             separator: ";",
//             quote: "",
//             skipComments: false,
//             strict: false,
//         }).on("data", (row) => {
//             const rowCategory = row["Kategori"];
//             if (
//                 category &&
//                 rowCategory &&
//                 rowCategory?.toLowerCase().trim() === category.toLowerCase().trim()
//             ) {
//                 results.push({
//                     SKU: row["Varenr."],
//                     Category: row["Kategori"],
//                     Price: row["Listepris"],
//                     Image: row["Bildelenk"],
//                     Description: row["Beskrivelse"],
//                     ProductTitle: row["Produkt"],
//                 });
//             }
//         })
//             .on("error", () => { throw new Error("Error parsing CSV file") }));



//     await finished(parser);
//     // console.log("Parsed records:", results.length);
//     return results;
// }


export const loader = async ({ request, params }) => {
    try {
        const url = new URL(request.url);
        const category = url.searchParams.get("category");
        if (!category) {
            return new Response(
                JSON.stringify({ message: "Category is required." }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        const firstStatus = await prisma.SyncStatus.findFirst();
        if (firstStatus?.isProductImportProcessing === true) {
            return new Response(
                JSON.stringify({ message: "Product import is already in progress." }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        }
        if (!firstStatus) {
            return new Response(
                JSON.stringify({ message: "No sync status data found." }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        } else {
            const updateFirstStatus = await prisma.SyncStatus.update({
                where: { id: firstStatus.id },
                data: { isProductImportProcessing: true },
            });
        }

        const shopData = await prisma.session.findMany();
        // const shopData = [{
        //     shop: "mjfdah-nh.myshopify.com",
        //     accessToken: process.env.SHOPIFY_ACCESS_TOKEN
        // }]
        console.log('shopData===================>', shopData);
        if (!shopData.length) return { message: "No shop data found." };

        const parseResults = await parseCsvFromSftp({ category });
        // console.log("parseResults length:", parseResults.length);
        if (!parseResults || parseResults.length === 0) {
            const secondStatus = await prisma.SyncStatus.findFirst();
            await prisma.SyncStatus.update({
                where: { id: secondStatus.id },
                data: { isProductImportProcessing: false },
            });
            return new Response(
                JSON.stringify({ message: "No products found for the specified category." }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }
        let collectionId = null;
        const getCollectionQuery = `
            query CustomCollectionList {
                collections(first: 50, query: "title:${parseResults[0].Category}") {
                    nodes {
                        id
                        handle
                        title
                    }
                }
            }
        `;

        const collectionFromShopify = await graphqlRequest(shopData, getCollectionQuery);
        console.log("collectionFromShopify:", collectionFromShopify);
        if (!collectionFromShopify || !collectionFromShopify.data || !collectionFromShopify.data.collections || !collectionFromShopify.data.collections.nodes) {
            const secondStatus = await prisma.SyncStatus.findFirst();
            await prisma.SyncStatus.update({
                where: { id: secondStatus.id },
                data: { isProductImportProcessing: false },
            });
            return new Response(
                JSON.stringify({ message: "Failed to fetch collections from Shopify." }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }
        if (!collectionFromShopify || !collectionFromShopify.data.collections || collectionFromShopify.data.collections.nodes.length === 0) {
            const collectionCreateMutation = `
            mutation CollectionCreate($input: CollectionInput!) {
                collectionCreate(input: $input) {
                    collection {
                    id
                    title
                    descriptionHtml
                    updatedAt
                    handle
                    image {
                        id
                        height
                        width
                        url
                    }
                    products(first: 10) {
                        nodes {
                        id
                        }
                    }
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }`
            const collectionCreateResult = await graphqlRequest(shopData, collectionCreateMutation, {
                variables: {
                    "input": {
                        "title": parseResults[0].Category,
                    }
                }
            })
            if (!collectionCreateResult || !collectionCreateResult.data || !collectionCreateResult.data.collectionCreate || !collectionCreateResult.data.collectionCreate.collection || collectionCreateResult.data.collectionCreate.userErrors.length > 0) {
                const secondStatus = await prisma.SyncStatus.findFirst();
                await prisma.SyncStatus.update({
                    where: { id: secondStatus.id },
                    data: { isProductImportProcessing: false },
                });
                return new Response(
                    JSON.stringify({ message: "Failed to create collection." }),
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
            }

            collectionId = collectionCreateResult.data.collectionCreate.collection.id;
            console.log("after creating collection collectionId:", collectionId);
        } else {
            collectionId = collectionFromShopify.data.collections.nodes[0].id;
            console.log("already exist collection collectionId:", collectionId);
        }

        if (!collectionId) {
            const secondStatus = await prisma.SyncStatus.findFirst();
            await prisma.SyncStatus.update({
                where: { id: secondStatus.id },
                data: { isProductImportProcessing: false },
            });
            return new Response(
                JSON.stringify({ message: "Collection ID not found." }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }

        for (const item of parseResults) {
            try {
                console.log(
                    `SKU: "${item.SKU}", Category: "${item.Category}", Price: "${item.Price}", Image: "${item.Image}", Description: "${item.Description}", ProductTitle: "${item.ProductTitle}"`
                );


                if (item.Price) {
                    const existingProductQuery = `
                        query {
                            products(first: 10, query: "sku:${item.SKU}") {
                                nodes {
                                    id
                                    title
                                }
                            }
                        }
                    `;
                    const existingProductResult = await graphqlRequest(shopData, existingProductQuery);
                    // console.log("existingProductResult:", existingProductResult);
                    if (existingProductResult && existingProductResult?.data && existingProductResult?.data?.products && existingProductResult?.data?.products?.nodes && existingProductResult?.data?.products?.nodes?.length > 0) {
                        console.log(`Product with SKU ${item.SKU} already exists.`);
                        continue; // skipping the existing item.
                    }

                    const productCreationMutation = `
                        mutation {
                            productCreate(
                                product: {title: "${item.ProductTitle}", collectionsToJoin: ["${collectionId}"], descriptionHtml: "${item.Description}"}
                            ) {
                                userErrors {
                                    field
                                    message
                                }
                                product {
                                    id
                                    title
                                    variants(first: 10) {
                                        nodes {
                                            id
                                            sku
                                            title
                                        }
                                    }
                                }
                            }
                        }
                    `
                    const productCreationResult = await graphqlRequest(shopData, productCreationMutation)
                    // console.log("productCreationResult:", productCreationResult);
                    if (!productCreationResult || !productCreationResult.data || !productCreationResult.data.productCreate || productCreationResult.data.productCreate.userErrors.length > 0) {
                        console.error("Failed to create product:", productCreationResult.data.productCreate.userErrors);
                        continue; // skipping this item because product creation failed
                    }
                    const productId = productCreationResult.data.productCreate.product.id;
                    const vatiantId = productCreationResult.data.productCreate.product.variants.nodes[0].id;
                    console.log("Created product with ID:", productId);
                    console.log("Created variant with ID:", vatiantId);
                    if (!productId || !vatiantId) {
                        console.error("Product ID or Variant ID not found after creation.");
                        continue; // skipping this item because product ID is missing
                    }
                    // const variantUpdateMutation = `
                    // mutation ProductVariantsUpdate($productId: ID!) {
                    //     productVariantsBulkUpdate(
                    //         productId: $productId
                    //         media: [{originalSource: "${item.Image}", mediaContentType: IMAGE}]
                    //         variants: [{id: "${vatiantId}", price: ${parseFloat(item.Price)}, inventoryItem: {sku: "${item.SKU}"}}]
                    //     ) {
                    //             product {
                    //                 id
                    //             }
                    //             productVariants {
                    //                 id
                    //             }
                    //             userErrors {
                    //                 field
                    //                 message
                    //             }
                    //         }
                    //     }
                    // `

                    const variantUpdateMutation = `
                    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $media: [CreateMediaInput!]) {
                        productVariantsBulkUpdate(productId: $productId, variants: $variants, media: $media) {
                            product {
                                id
                            }
                            productVariants {
                                id
                            }
                            userErrors {
                                field
                                message
                            }
                        }
                    }
                    `
                    const variantUpdateResult = await graphqlRequest(shopData, variantUpdateMutation, {
                        variables: {
                            productId: productId,
                            ...(item.Image ? { media: [{ originalSource: item.Image.replace(/ /g, "%20"), mediaContentType: "IMAGE" }] } : {}),
                            variants: [{
                                id: vatiantId,
                                price: parseFloat(item.Price),
                                inventoryItem: { sku: item.SKU, tracked: true },
                            }]
                        }
                    });
                    // console.log("variantUpdateResult:", variantUpdateResult);
                    if (!variantUpdateResult || !variantUpdateResult.data || !variantUpdateResult.data.productVariantsBulkUpdate || variantUpdateResult.data.productVariantsBulkUpdate.userErrors.length > 0) {
                        console.error("Failed to update product variants:", variantUpdateResult.data.productVariantsBulkUpdate.userErrors);
                        continue; // skipping this item because variant update failed
                    }
                    console.log("Product variants updated successfully for SKU:", item.SKU);
                } else {
                    console.log(`Skipping product creation for SKU: ${item.SKU} due to missing price.`);
                    continue; // skipping this item because price is missing
                }

            } catch (error) {
                console.error("Error processing item:", item, error);
                continue; // skipping this item due to error
            }
        }

        console.log("==============All products processed successfully==============");

        const secondStatus = await prisma.SyncStatus.findFirst();
        await prisma.SyncStatus.update({
            where: { id: secondStatus.id },
            data: { isProductImportProcessing: false },
        });

        return { success: true, data: parseResults };
    } catch (error) {
        const thirdStatus = await prisma.SyncStatus.findFirst();
        await prisma.SyncStatus.update({
            where: { id: thirdStatus.id },
            data: { isProductImportProcessing: false },
        });
        console.error("error reading CSV from api.importProducts:", error);
        return new Response(
            JSON.stringify({ error: error, message: "error reading CSV from api.importProducts" }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
