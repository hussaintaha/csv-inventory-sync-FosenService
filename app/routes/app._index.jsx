import { useState, useCallback, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  FormLayout,
  Select,
} from "@shopify/polaris";

export default function Index() {
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');

  const categoryOptions = [
    { label: 'Sommerdekk', value: 'Sommerdekk' },
    { label: 'Slanger', value: 'Slanger' },
    { label: 'Tilhenger og AW -dekk', value: 'Tilhenger og AW -dekk' },
    { label: 'Truckdekk', value: 'Truckdekk' },
    { label: 'M+S', value: 'M+S' },
    { label: 'Lastebil- og bussdekk', value: 'Lastebil- og bussdekk' },
    { label: 'Anleggsdekk', value: 'Anleggsdekk' },
    { label: 'M+S Pigg', value: 'M+S Pigg' },
    { label: 'Industridekk', value: 'Industridekk' },
    { label: 'Plen- og hagedekk', value: 'Plen- og hagedekk' },
    { label: 'Traktordekk', value: 'Traktordekk' },
    { label: 'High Speed Tilhengerdekk', value: 'High Speed Tilhengerdekk' },
    { label: 'MC dekk', value: 'MC dekk' },
    { label: 'ATV-dekk', value: 'ATV-dekk' },
    { label: 'Smådekk', value: 'Smådekk' },
  ]

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
      const response = await fetch(`/api/importProducts?category=${encodeURIComponent(category)}`); // encodeURIComponent added because + character in URLs is automatically decoded as a space by default when using URLSearchParams on server-side, so I encode it to ensure it is treated correctly.
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
          description="Import/Add products in shopify as per the selected category of your SFTP server CSV file."
        >
          <Card padding="600">
            <FormLayout>
              {/* <TextField
                label="Enter a category to import products"
                placeholder="e.g., Sommerdekk"
                type="text"
                value={category}
                onChange={(value) => setCategory(value)}
                autoComplete="off"
              /> */}
              <Select
                label="Select a category to import products"
                placeholder="e.g., Sommerdekk"
                options={categoryOptions}
                onChange={(v) => setCategory(v)}
                value={category}
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
