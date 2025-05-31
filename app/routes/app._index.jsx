import { useState, useCallback, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  InlineStack,
  TextField,
  FormLayout,
} from "@shopify/polaris";

export default function Index() {
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');

  const handleImportProduct = useCallback(async () => {
    setLoading(true);
    try {
      if (category.trim() === '') {
        shopify.toast.show({
          message: 'Please select a category to import products.',
          duration: 5000,
          isError: true,
        });
        return;
      }
      const response = await fetch(`/api/importProducts?category=${category}`);
      if (!response.ok) throw new Error('Sync failed');
      const data = await response.json();
      // console.log("Data received:", data);
    } catch (error) {
      console.error("Error syncing products:", error);
    }
  }, [category]);

  useEffect(() => {
    const fetchImportStatus = async () => {
      try {
        const response = await fetch('/api/getSyncStatus');
        if (!response.ok) throw new Error('Failed to fetch syncStatus data');
        const data = await response.json();
        console.log("Initial data fetched:", data);
        setLoading(data?.[0]?.isProductImportProcessing || false);
      } catch (error) {
        console.error("Error fetching syncStatus data:", error);
      }
    };
    fetchImportStatus();
  }, []);

  const handleSyncProduct = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/syncProducts');
      if (!response.ok) throw new Error('Sync failed');
      const data = await response.json();
      console.log("Data received:", data);
    } catch (error) {
      console.error("Error syncing products:", error);
    }
  }, []);

  return (
    <Page >
      <Layout>
        <Layout.Section>
          <div style={{ maxWidth: '800px', margin: '30px auto', padding: '24px', textAlign: 'center' }}>
            <div style={{ padding: '24px' }}>
              <Text variant="heading2xl" as="h1">
                🚀 Sync Your Inventory Effortlessly
              </Text>
              <Text variant="bodyLg" as="p" tone="subdued" style={{ marginTop: '16px' }}>
                Your product inventory syncs automatically from your SFTP folder. Keep your products inventory always up-to-date no manual work needed!
              </Text>
              {/* <div style={{ marginTop: '24px' }}>
                <Button primary onClick={handleSyncProduct} loading={loading} disabled={loading}>
                  {loading ? 'Syncing Products...' : 'Sync Products Now'}
                </Button>
              </div> */}
            </div>
          </div>
        </Layout.Section>

        <Layout.AnnotatedSection
          id="storeDetails"
          title="📦 Import Products by Category"
          description="Import products as per the category from your SFTP CSV file. Make sure the category matches the one in the CSV file; otherwise, the import feature will not work as expected."
        >
          <Card padding="600">
            <FormLayout>
              <TextField
                label="Enter a category to import products"
                placeholder="e.g., Sommerdekk"
                type="text"
                value={category}
                onChange={(value) => setCategory(value)}
                autoComplete="off"
              />
              <Button
                variant='primary'
                onClick={handleImportProduct}
                disabled={loading || !category}
              >
                {loading ? 'Importing…' : 'Import Products'}
              </Button>
            </FormLayout>
          </Card>
        </Layout.AnnotatedSection>
      </Layout>
    </Page>

  );
}
