import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAWNIX_SETTINGS_KEY } from '../../constants/storage';

function createStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

function mockSettingsManagerDeps() {
  vi.doMock('../crypto-utils', () => ({
    CryptoUtils: {
      testCrypto: async () => false,
      isEncrypted: () => false,
      decrypt: async (value: string) => value,
      encrypt: async (value: string) => value,
    },
  }));

  vi.doMock('../config-indexeddb-writer', () => ({
    configIndexedDBWriter: {
      saveConfig: async () => {},
    },
  }));
}

describe('settings-manager', () => {
  beforeEach(() => {
    vi.resetModules();

    if (typeof globalThis.localStorage?.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });
    }

    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {
        location: {
          search: '',
          href: 'https://example.com/app',
        },
        history: {
          replaceState: () => {},
        },
        dispatchEvent: () => true,
      });
    } else {
      Object.assign(window, {
        location: {
          search: '',
          href: 'https://example.com/app',
        },
        history: {
          replaceState: () => {},
        },
        dispatchEvent: () => true,
      });
    }

    localStorage.clear();
  });

  it('defaults missing compatibility while preserving managed profile details and explicit values', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: '兔子 AI',
            providerType: 'custom',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'query',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'tuzi-origin',
            name: '兔子 原价',
            providerType: 'gemini-compatible',
            baseUrl: 'https://example.com/custom-endpoint',
            apiKey: 'origin-key',
            authType: 'header',
            imageApiCompatibility: 'tuzi-gpt-image',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'custom-auto',
            name: '自定义自动',
            providerType: 'openai-compatible',
            baseUrl: 'https://gateway-auto.example.com/v1',
            apiKey: 'auto-key',
            authType: 'bearer',
            imageApiCompatibility: 'auto',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'custom-missing',
            name: '自定义缺省',
            providerType: 'openai-compatible',
            baseUrl: 'https://gateway-missing.example.com/v1',
            apiKey: 'missing-key',
            authType: 'bearer',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'custom-provider',
            name: '自定义供应商',
            providerType: 'openai-compatible',
            baseUrl: 'https://gateway.example.com/v1',
            apiKey: 'custom-key',
            authType: 'bearer',
            imageApiCompatibility: 'tuzi-compatible',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'invalid-provider',
            name: '错误配置供应商',
            providerType: 'openai-compatible',
            baseUrl: 'https://invalid.example.com/v1',
            apiKey: 'invalid-key',
            authType: 'bearer',
            imageApiCompatibility: 'unknown-mode',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      TUZI_CODEX_PROVIDER_PROFILE_ID,
      TUZI_MIX_PROVIDER_PROFILE_ID,
      TUZI_BUSINESS_PROVIDER_PROFILE_ID,
      TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const profiles = providerProfilesSettings.get();
    const legacyProfile = profiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );

    expect(legacyProfile).toMatchObject({
      name: 'LeeFun',
      iconUrl: '/logo-leefun.svg',
      baseUrl: 'https://aiapi.leefun.top/v1',
      providerType: 'custom',
      authType: 'query',
      imageApiCompatibility: LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    });
    expect(
      profiles.some((profile) =>
        [
          TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
          TUZI_MIX_PROVIDER_PROFILE_ID,
          TUZI_CODEX_PROVIDER_PROFILE_ID,
          TUZI_BUSINESS_PROVIDER_PROFILE_ID,
        ].includes(profile.id)
      )
    ).toBe(false);
    expect(
      profiles.find((profile) => profile.id === 'custom-auto')
    ).toMatchObject({
      imageApiCompatibility: 'auto',
    });
    expect(
      profiles.find((profile) => profile.id === 'custom-missing')
    ).toMatchObject({
      imageApiCompatibility: DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    });
    expect(
      profiles.find((profile) => profile.id === 'custom-provider')
    ).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(
      profiles.find((profile) => profile.id === 'invalid-provider')
    ).toMatchObject({
      imageApiCompatibility: 'auto',
    });

    await providerProfilesSettings.update([
      ...profiles.filter((profile) => profile.id !== 'custom-provider'),
      {
        id: 'custom-provider',
        name: '自定义供应商',
        providerType: 'openai-compatible',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'custom-key',
        authType: 'bearer',
        imageApiCompatibility: 'tuzi-compatible' as any,
        enabled: true,
        capabilities: {
          supportsModelsEndpoint: true,
          supportsText: true,
          supportsImage: true,
          supportsVideo: true,
          supportsAudio: true,
          supportsTools: true,
        },
      },
    ]);

    const updatedCustomProfile = providerProfilesSettings
      .get()
      .find((profile) => profile.id === 'custom-provider');

    expect(updatedCustomProfile).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
  });

  it('migrates legacy default Tuzi GPT Image compatibility only once', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'bearer',
            imageApiCompatibility: 'openai-gpt-image',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      settingsManager,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const migratedProfile = providerProfilesSettings
      .get()
      .find((profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID);

    expect(migratedProfile).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(settingsManager.getSettings().migrations).toMatchObject({
      legacyDefaultImageApiCompatibilityV1: true,
    });

    await providerProfilesSettings.update(
      providerProfilesSettings.get().map((profile) =>
        profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
          ? {
              ...profile,
              imageApiCompatibility: 'openai-gpt-image' as const,
            }
          : profile
      )
    );

    vi.resetModules();
    mockSettingsManagerDeps();

    const reloaded = await import('../settings-manager');
    const reloadedLegacyProfile = reloaded.providerProfilesSettings
      .get()
      .find(
        (profile) => profile.id === reloaded.LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );

    expect(reloadedLegacyProfile).toMatchObject({
      imageApiCompatibility: 'openai-gpt-image',
    });
    expect(reloaded.settingsManager.getSettings().migrations).toMatchObject({
      legacyDefaultImageApiCompatibilityV1: true,
    });
  });

  it('migrates legacy default image model only once', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          imageModelName: 'gpt-image-2-vip',
        },
        invocationPresets: [
          {
            id: 'default',
            name: '默认方案',
            isDefault: true,
            text: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'gemini-2.5-pro-all',
              },
            },
            audio: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'suno_music',
              },
            },
            image: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'gpt-image-2-vip',
              },
            },
            video: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'seedance-1.5-pro',
              },
            },
          },
        ],
      })
    );

    const { settingsManager } = await import('../settings-manager');
    const settings = settingsManager.getSettings();

    expect(settings.gemini.imageModelName).toBe('gpt-image-2');
    expect(settings.invocationPresets[0]?.image.defaultModelRef).toMatchObject({
      profileId: 'legacy-default',
      modelId: 'gpt-image-2',
    });
    expect(settings.migrations).toMatchObject({
      legacyDefaultImageModelV1: true,
    });

    await settingsManager.updateActiveInvocationRouteModel('image', {
      profileId: 'legacy-default',
      modelId: 'gpt-image-2-vip',
    });

    vi.resetModules();
    mockSettingsManagerDeps();

    const reloaded = await import('../settings-manager');
    const reloadedSettings = reloaded.settingsManager.getSettings();

    expect(reloadedSettings.gemini.imageModelName).toBe('gpt-image-2-vip');
    expect(
      reloadedSettings.invocationPresets[0]?.image.defaultModelRef
    ).toMatchObject({
      profileId: 'legacy-default',
      modelId: 'gpt-image-2-vip',
    });
    expect(reloadedSettings.migrations).toMatchObject({
      legacyDefaultImageModelV1: true,
    });
  });

  it('does not migrate legacy default compatibility when the default baseUrl is not Tuzi', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'openai-key',
            authType: 'bearer',
            imageApiCompatibility: 'openai-gpt-image',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      settingsManager,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const legacyProfile = providerProfilesSettings
      .get()
      .find((profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID);

    expect(legacyProfile).toMatchObject({
      imageApiCompatibility: 'openai-gpt-image',
    });
    expect(settingsManager.getSettings().migrations).toMatchObject({
      legacyDefaultImageApiCompatibilityV1: true,
    });
  });

  it('filters legacy managed profile groups after reload', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
      })
    );

    const {
      providerProfilesSettings,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      TUZI_CODEX_PROVIDER_PROFILE_ID,
      TUZI_MIX_PROVIDER_PROFILE_ID,
      TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
      TUZI_BUSINESS_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const profiles = providerProfilesSettings.get();

    await providerProfilesSettings.update(
      [
        ...profiles.map((profile) =>
          profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
            ? {
                ...profile,
                imageApiCompatibility: 'tuzi-gpt-image' as const,
              }
            : profile
        ),
        {
          id: TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
          name: '原价分组',
          providerType: 'openai-compatible' as const,
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'origin-key',
          authType: 'bearer' as const,
          imageApiCompatibility: 'auto' as const,
          enabled: true,
          capabilities: {},
        },
        {
          id: TUZI_MIX_PROVIDER_PROFILE_ID,
          name: 'gemini-mix 分组',
          providerType: 'openai-compatible' as const,
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'mix-key',
          authType: 'bearer' as const,
          imageApiCompatibility: 'openai-compatible-basic' as const,
          enabled: true,
          capabilities: {},
        },
        {
          id: TUZI_CODEX_PROVIDER_PROFILE_ID,
          name: 'codex 分组',
          providerType: 'openai-compatible' as const,
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'codex-key',
          authType: 'bearer' as const,
          imageApiCompatibility: 'tuzi-gpt-image' as const,
          enabled: true,
          capabilities: {},
        },
        {
          id: TUZI_BUSINESS_PROVIDER_PROFILE_ID,
          name: 'Business',
          providerType: 'openai-compatible' as const,
          baseUrl: 'https://business.tu-zi.com/v1',
          homepageUrl: 'business.tu-zi.com/dashboard',
          pricingUrl: 'https://business.tu-zi.com/api/pricing?group=vip',
          apiKey: 'business-key',
          authType: 'bearer' as const,
          imageApiCompatibility: 'auto' as const,
          enabled: true,
          capabilities: {},
        },
      ]
    );

    vi.resetModules();
    mockSettingsManagerDeps();

    const reloaded = await import('../settings-manager');
    const reloadedProfiles = reloaded.providerProfilesSettings.get();

    expect(
      reloadedProfiles.find(
        (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      )
    ).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(
      reloadedProfiles.some((profile) =>
        [
          TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
          TUZI_MIX_PROVIDER_PROFILE_ID,
          TUZI_CODEX_PROVIDER_PROFILE_ID,
          TUZI_BUSINESS_PROVIDER_PROFILE_ID,
        ].includes(profile.id)
      )
    ).toBe(false);
  });

  it('removes legacy special profiles while preserving default async image preference', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'bearer',
            imageApiCompatibility: 'tuzi-gpt-image',
            preferAsyncImageEndpoint: true,
            enabled: true,
            capabilities: {},
          },
          {
            id: 'tuzi-origin',
            name: '原价分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'origin-key',
            authType: 'bearer',
            imageApiCompatibility: 'tuzi-gpt-image',
            preferAsyncImageEndpoint: true,
            enabled: true,
            capabilities: {},
            pricingGroup: 'default',
          },
          {
            id: 'tuzi-mix',
            name: 'gemini-mix 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'mix-key',
            authType: 'bearer',
            imageApiCompatibility: 'openai-gpt-image',
            preferAsyncImageEndpoint: true,
            enabled: true,
            capabilities: {},
            pricingGroup: 'gemini-mix',
          },
          {
            id: 'tuzi-codex',
            name: 'codex 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'codex-key',
            authType: 'bearer',
            imageApiCompatibility: 'openai-gpt-image',
            preferAsyncImageEndpoint: true,
            enabled: true,
            capabilities: {},
            pricingGroup: 'codex',
          },
          {
            id: 'tuzi-business',
            name: 'Business',
            providerType: 'openai-compatible',
            baseUrl: 'https://business.tu-zi.com/v1',
            apiKey: 'business-key',
            authType: 'bearer',
            imageApiCompatibility: 'auto',
            preferAsyncImageEndpoint: true,
            enabled: true,
            capabilities: {},
            pricingGroup: 'default',
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
      TUZI_MIX_PROVIDER_PROFILE_ID,
      TUZI_CODEX_PROVIDER_PROFILE_ID,
      TUZI_BUSINESS_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const profiles = providerProfilesSettings.get();
    const legacyProfile = profiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );

    expect(legacyProfile).toMatchObject({
      preferAsyncImageEndpoint: true,
    });
    expect(
      profiles.some((profile) =>
        [
          TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
          TUZI_MIX_PROVIDER_PROFILE_ID,
          TUZI_CODEX_PROVIDER_PROFILE_ID,
          TUZI_BUSINESS_PROVIDER_PROFILE_ID,
        ].includes(profile.id)
      )
    ).toBe(false);

    await providerProfilesSettings.update(
      profiles.map((profile) => ({
        ...profile,
        preferAsyncImageEndpoint: false,
      }))
    );

    vi.resetModules();
    mockSettingsManagerDeps();

    const reloaded = await import('../settings-manager');
    const reloadedLegacyProfile = reloaded.providerProfilesSettings
      .get()
      .find(
        (profile) => profile.id === reloaded.LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );

    expect(reloadedLegacyProfile).toMatchObject({
      preferAsyncImageEndpoint: false,
    });
    expect(
      reloaded.providerProfilesSettings.get().some((profile) =>
        [
          reloaded.TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
          reloaded.TUZI_MIX_PROVIDER_PROFILE_ID,
          reloaded.TUZI_CODEX_PROVIDER_PROFILE_ID,
          reloaded.TUZI_BUSINESS_PROVIDER_PROFILE_ID,
        ].includes(profile.id)
      )
    ).toBe(false);
  });
});
