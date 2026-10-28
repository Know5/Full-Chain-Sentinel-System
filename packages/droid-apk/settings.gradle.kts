// 国内本地构建默认走阿里云镜像；CI 默认走官方仓库。
//
// 阿里云 gradle-plugin 镜像曾对 com.android.tools.build:gradle-settings-api:8.5.2
// 返回 502，Gradle 不会把它当成 404 继续尝试后面的 google()，整次构建因此失败。
// CI 上直接用官方仓库；需要显式覆盖时设 SENTINEL_GRADLE_MIRROR=on|off。
pluginManagement {
	val mirror = System.getenv("SENTINEL_GRADLE_MIRROR")?.lowercase()
	val useAliyun = when (mirror) {
		"off" -> false
		"on" -> true
		else -> System.getenv("CI") != "true"
	}
	repositories {
		if (useAliyun) {
			maven("https://maven.aliyun.com/repository/gradle-plugin")
			maven("https://maven.aliyun.com/repository/google")
			maven("https://maven.aliyun.com/repository/public")
		}
		google()
		mavenCentral()
		gradlePluginPortal()
	}
}
dependencyResolutionManagement {
	val mirror = System.getenv("SENTINEL_GRADLE_MIRROR")?.lowercase()
	val useAliyun = when (mirror) {
		"off" -> false
		"on" -> true
		else -> System.getenv("CI") != "true"
	}
	repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
	repositories {
		if (useAliyun) {
			maven("https://maven.aliyun.com/repository/google")
			maven("https://maven.aliyun.com/repository/public")
		}
		google()
		mavenCentral()
	}
}
rootProject.name = "DroidBridge"
include(":app")
