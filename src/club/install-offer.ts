/**
 * Chrome and Edge offer to install the site with a one-time "beforeinstallprompt" event, and say "appinstalled" afterwards. Neither
 * is repeated, and on a slow phone they can arrive before React has started listening, so the sign-in page carries this tiny
 * script. It runs while the page is still loading, keeps the offer on `window.__ccsInstallOffer`, and tells the card (with
 * `ccs-install-offer`) when that changes. The card reads it whenever it starts.
 */
export const INSTALL_OFFER_EVENT = "ccs-install-offer";

export const INSTALL_CAPTURE_SCRIPT = `(function(){
  function note(){window.dispatchEvent(new Event("${INSTALL_OFFER_EVENT}"));}
  window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__ccsInstallOffer=e;note();});
  window.addEventListener("appinstalled",function(){window.__ccsInstallOffer=null;note();});
})();`;
