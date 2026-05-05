import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

const PUBLIC_KEYS = [
	'PUBLIC_ATP_SERVICE',
	'PUBLIC_AT_FUNCTIONS_API',
	'PUBLIC_ATSEARCH_URL',
	'PUBLIC_DEFAULT_FUNCTIONS_HANDLE',
] as const;

function publicDefine(mode: string) {
	const fileEnv = loadEnv(mode, process.cwd(), 'PUBLIC_');
	const out: Record<string, string> = {};
	for (const key of PUBLIC_KEYS) {
		const fromProcess = process.env[key];
		const fromFile = fileEnv[key];
		const v =
			fromProcess !== undefined && fromProcess !== ''
				? fromProcess
				: fromFile !== undefined && fromFile !== ''
					? fromFile
					: undefined;
		out[`import.meta.env.${key}`] =
			v === undefined ? 'void 0' : JSON.stringify(v);
	}
	return out;
}

export default defineConfig(({ mode }) => ({
	plugins: [sveltekit()],
	define: publicDefine(mode),
	server: {
		port: 5200,
	},
}));
