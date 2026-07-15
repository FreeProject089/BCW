# Héberger les projets Docker des utilisateurs — architecture & plan (FUTUR, pas encore construit)

*🇬🇧 [English version](USER_PROJECT_HOSTING_EN.md).*

> Statut : **conception uniquement.** Rien ici n'est implémenté. Ce document capture la voie
> visée pour que, le jour où l'on hébergera les propres projets conteneurisés des
> utilisateurs (un mini-PaaS au-dessus de l'hébergement Server-Repo actuel), on **étende la
> couture existante** au lieu de bricoler avec le mauvais outil.

## Objectif

Aujourd'hui BCWEB héberge des **Server-Repos** (payloads statiques/JSON sur S3, servis par
l'API). L'extension future : laisser un utilisateur pousser un **projet sous forme de
conteneur Docker** (son app / bot / petit service) et on le fait tourner, isolé et sous quota,
accessible à une URL.

## A-t-on besoin de Kubernetes ? **Non.**

- L'app elle-même n'a jamais eu besoin de K8s — la montée en charge verticale + une plateforme
  managée suffisent (voir `DEPLOY_FR.md`).
- Pour faire tourner les conteneurs *des utilisateurs*, K8s est aussi le mauvais premier
  outil : lourd à opérer et — surtout — **K8s nu N'ISOLE PAS de façon sûre du code non-fiable**
  (noyau partagé → risque d'évasion de conteneur). Il faudrait quand même une isolation microVM
  (gVisor / Kata / Firecracker) par-dessus. K8s ajoute un cluster à opérer *et* laisse le
  problème difficile (l'isolation) non résolu.
- Notre situation colle bien mieux à un **VPS unique, verticalement extensible, à accès
  direct** : piloter le Docker Engine directement, ajouter des nœuds seulement quand une
  machine est vraiment pleine.

## La couture existe déjà

`apps/provisioner/src/index.mjs` → **`spinUpRepoContainer(repo)`** est le point d'extension
marqué, et le modèle `ServerRepo` porte déjà les champs de quota (`storageQuotaBytes`,
`uploadLimitKbps`, `cpuShare`). Le provisioner possède déjà la préoccupation
« isolation/quota », découplée de l'API web. Héberger les projets utilisateurs =
faire en sorte que `spinUpRepoContainer` crée réellement un conteneur au lieu de juste
réserver un préfixe S3.

## Architecture recommandée (par phases)

**Phase 1 — VPS unique, API Docker Engine (dockerode).**
- Le provisioner parle au socket Docker de l'hôte via **dockerode** et, par projet : crée un
  conteneur depuis l'image de l'utilisateur (ou une image buildée), sur un **réseau Docker
  interne**, avec des **limites dures** (`--memory`, `--cpus`/`CpuShares`, `PidsLimit`, rootfs
  en lecture seule quand possible, `--cap-drop ALL`, aucun montage hôte, un volume nommé sous
  quota pour ses données).
- **Routage :** le **TLS on-demand + upstream dynamique** de Caddy mappe `project.<domaine>`
  (ou `/p/<id>`) → le port interne du conteneur. Le provisioner enregistre/retire la route au
  fur et à mesure que les conteneurs montent/descendent (API admin de Caddy ou un fragment
  généré).
- **Cycle de vie :** le provisioner réconcilie l'état désiré en base (`PROVISIONING` /
  `ONLINE` / `STOPPED`) avec les conteneurs réels à chaque tick — le patron déjà présent.

**Phase 1.5 — isoler le code non-fiable (à faire AVANT toute ouverture au public).**
- Faire tourner les conteneurs de projet sous **gVisor (`runsc`)** ou **Kata/Firecracker** pour
  qu'une image hostile ne puisse pas toucher le noyau hôte. C'est le contrôle de sécurité le
  plus important ; un conteneur Docker normal n'est *pas* une frontière de confiance pour du
  code utilisateur arbitraire.
- Pare-feu de sortie (bloquer SMTP/abus), plafonds CPU/mém/pids/disque par projet, plafonds
  logs/qps.

**Phase 2 — plusieurs nœuds, seulement quand un gros VPS est plein.**
- Utiliser **Nomad** (+ Consul) comme ordonnanceur : dramatiquement plus simple à opérer que
  K8s, avec un modèle « fais juste tourner ces conteneurs/jobs batch sur les nœuds » de
  première classe qui colle à ce cas d'usage. Le provisioner soumet des jobs Nomad au lieu
  d'appeler dockerode directement ; la base reste la source de vérité.
- **Kubernetes managé** seulement si ça devient une grosse plateforme multi-locataire avec une
  équipe pour l'opérer — et même là, garder l'isolation microVM de la Phase 1.5.

## Ce qu'il faut préparer maintenant (pas cher, aucun nouveau service)

- Garder le provisioner comme **seule** chose qui touche à l'isolation runtime (déjà le cas).
- En implémentant la Phase 1, mettre le driver Docker derrière une petite interface
  (`spinUp/tearDown/reconcile`) pour que remplacer dockerode → Nomad plus tard soit un
  changement de driver, pas une réécriture — comme le stockage est déjà en interface S3
  (MinIO → R2) et la base un simple swap `.env`.
- Dimensionner le VPS avec de la marge ; préférer les **montées verticales** (plus de
  CPU/RAM/disque) à un second nœud aussi longtemps que possible.

## Résumé en une ligne

Étendre le **provisioner + l'API Docker Engine** sur un gros VPS, isoler les conteneurs
non-fiables avec **gVisor/Firecracker**, router via les **upstreams dynamiques de Caddy**, et
ne passer à **Nomad** (pas Kubernetes) que quand on a vraiment besoin de plusieurs nœuds.
