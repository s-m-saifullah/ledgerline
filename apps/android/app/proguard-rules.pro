# kotlinx.serialization keeps its generated serializers through its own consumer rules.

# Retrofit reads the type a suspend function answers with from its generic signature. A write whose answer the app never
# reads (a lend, borrow, repay or client payment only passes it along) has that class removed as unused, the signature
# turns into Object and the first call crashes ("Unable to create converter for class java.lang.Object"). Keep every API
# type; names may still be shortened. infra/scripts/android-r8-check.mjs fails the build when one is removed anyway.
-keep,allowobfuscation class app.ledgerline.api.**
