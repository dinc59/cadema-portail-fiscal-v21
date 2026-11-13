import { CademaGristBridge } from './grist-adapter.js';

const bridge = new CademaGristBridge();
window.CADEMA_GRIST = bridge;

/* L'ordre compte : `portal.js` lit `globalThis.CADEMA_PROFILS` une seule fois,
   à l'évaluation du module. Le `await` ci-dessous garantit que l'adaptateur a
   fini avant que le bundle ne commence — c'est une garantie du langage, pas
   une temporisation.
   Le `try` garantit l'autre moitié : si l'initialisation échoue, le portail
   se charge quand même, avec son profil par défaut, plutôt que de laisser une
   page blanche. */
try {
  await bridge.init();
} catch (error) {
  console.error('Initialisation CADEMA interrompue', error);
}

await import('./portal.js');

try {
  bridge.watchPortal();
} catch (error) {
  console.error('Surveillance du portail indisponible', error);
}

/* Couche d'interactions V21 : chargée après le portail, isolée dans son
   propre `try` — si elle échoue, le portail reste celui de la V20. */
try {
  const { startV21 } = await import('./v21-ui.js');
  startV21();
} catch (error) {
  console.error('Interactions V21 indisponibles', error);
}
