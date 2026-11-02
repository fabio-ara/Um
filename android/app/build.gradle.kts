plugins { id("com.android.application") }
val webRoot=rootProject.projectDir.parentFile
val assetsRoot=layout.buildDirectory.dir("generated/web-assets")
val releaseRequested=gradle.startParameter.taskNames.any { it.contains("release",ignoreCase=true) }
val signingPath=System.getenv("UM_ANDROID_KEYSTORE_PATH").orEmpty()
val signingStorePassword=System.getenv("UM_ANDROID_KEYSTORE_PASSWORD").orEmpty()
val signingAlias=System.getenv("UM_ANDROID_KEY_ALIAS").orEmpty()
val signingKeyPassword=System.getenv("UM_ANDROID_KEY_PASSWORD").orEmpty()
val signingReady=listOf(signingPath,signingStorePassword,signingAlias,signingKeyPassword).all { it.isNotBlank() } && file(signingPath).isFile
val stageWeb by tasks.registering(Exec::class) {
 workingDir(webRoot)
 commandLine("node","scripts/stage-android.mjs",assetsRoot.get().asFile.absolutePath,if(releaseRequested)"release" else "debug")
 inputs.dir(File(webRoot,"src"));inputs.dir(File(webRoot,"public"));inputs.file(File(webRoot,"vite.config.ts"));inputs.file(File(webRoot,"index.html"))
 inputs.file(File(webRoot,"scripts/stage-android.mjs"));inputs.file(File(webRoot,"package.json"));inputs.file(File(webRoot,"package-lock.json"))
 inputs.property("api",System.getenv("VITE_API_ORIGIN").orEmpty());inputs.property("release",releaseRequested)
 outputs.dir(assetsRoot)
 // A cached task must never skip the clean-candidate and HTTPS release guards.
 outputs.upToDateWhen { !releaseRequested }
}
android {
 namespace="com.fabioara.um";compileSdk=36
 defaultConfig { applicationId="com.fabioara.um";minSdk=24;targetSdk=36;versionCode=1;versionName="0.1.0" }
 signingConfigs { if(signingReady)create("release") { storeFile=file(signingPath);storePassword=signingStorePassword;keyAlias=signingAlias;keyPassword=signingKeyPassword } }
 buildTypes {
  release { isMinifyEnabled=false;if(signingReady)signingConfig=signingConfigs.getByName("release") }
  debug { applicationIdSuffix=".debug";versionNameSuffix="-debug" }
 }
 compileOptions { sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17 }
 sourceSets.getByName("main").assets.directories.add(assetsRoot.get().asFile.absolutePath)
}
dependencies {
 implementation("androidx.activity:activity:1.12.4")
 implementation("androidx.core:core:1.17.0")
 implementation("androidx.webkit:webkit:1.15.0")
}
tasks.named("preBuild") { dependsOn(stageWeb) }
tasks.matching { it.name=="preReleaseBuild" }.configureEach { doFirst { check(signingReady) { "Assinatura própria do Um ausente; release não usa assinatura debug nem de outro produto." } } }
