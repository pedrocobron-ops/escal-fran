// Projeto Supabase "clientes-basicos" (organização pedrocobron-ops), schema escala_ceo.
// A chave abaixo é a chave pública (anon): ela vai para o navegador de qualquer forma e
// só consegue chamar as três funções de docs/supabase.sql, que exigem o código da escala.
// O código da escala é o segredo, e fica só nos aparelhos do cliente.
export const CLOUD_PROJECT = {
  url: 'https://pifuiczrytmizqxzygbi.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpZnVpY3pyeXRtaXpxeHp5Z2JpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNzM2MDQsImV4cCI6MjEwNjk0OTYwNH0.LcJfh9mGhspaUDIFN4u5mtvHJZX0zoDF9GpOCuQta3o',
} as const;
