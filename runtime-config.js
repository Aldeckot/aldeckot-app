(() => {
  const hasConfiguration = config => Boolean(config?.url && config?.publishableKey);

  const loadStaticFallback = () => new Promise(resolve => {
    if (hasConfiguration(window.ALDECKOT_SUPABASE_CONFIG)) return resolve(window.ALDECKOT_SUPABASE_CONFIG);
    const script = document.createElement('script');
    script.src = 'supabase-config.js';
    script.onload = () => resolve(window.ALDECKOT_SUPABASE_CONFIG || {});
    script.onerror = () => {
      window.ALDECKOT_SUPABASE_CONFIG_ERROR = window.ALDECKOT_SUPABASE_CONFIG_ERROR
        ? `${window.ALDECKOT_SUPABASE_CONFIG_ERROR} O arquivo supabase-config.js também não foi publicado.`
        : 'O arquivo supabase-config.js não foi publicado.';
      resolve({});
    };
    document.head.appendChild(script);
  });

  const loadVercelConfiguration = async () => {
    const response = await fetch('/api/supabase-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuração remota indisponível.');
    const configuration = await response.json();
    if (!hasConfiguration(configuration)) throw new Error('Configuração remota inválida.');
    window.ALDECKOT_SUPABASE_CONFIG = configuration;
    return configuration;
  };

  const hasStaticConfiguration = hasConfiguration(window.ALDECKOT_SUPABASE_CONFIG);
  const isLocalFile = window.location.protocol === 'file:';

  // Em desenvolvimento local o arquivo de configuração é carregado diretamente.
  // No Vercel, a rota de runtime cobre tanto builds estáticos quanto previews.
  const configurationSource = hasStaticConfiguration
    ? Promise.resolve(window.ALDECKOT_SUPABASE_CONFIG)
    : isLocalFile
      ? loadStaticFallback()
      : loadVercelConfiguration().catch(error => {
          // Mantém o motivo disponível para diagnóstico sem expor nenhuma credencial.
          window.ALDECKOT_SUPABASE_CONFIG_ERROR = error.message;
          return loadStaticFallback();
        });

  // O Supabase client aguarda esta promessa antes de criar a conexão.
  window.ALDECKOT_SUPABASE_CONFIG_READY = configurationSource
    .then(configuration => {
      window.ALDECKOT_SUPABASE_CONFIG = configuration || window.ALDECKOT_SUPABASE_CONFIG || {};
      if (!hasConfiguration(window.ALDECKOT_SUPABASE_CONFIG) && !window.ALDECKOT_SUPABASE_CONFIG_ERROR) {
        window.ALDECKOT_SUPABASE_CONFIG_ERROR = isLocalFile
          ? 'Não foi possível carregar o arquivo local supabase-config.js.'
          : 'A configuração pública do Supabase não foi encontrada.';
      }
      return window.ALDECKOT_SUPABASE_CONFIG;
    });
})();
