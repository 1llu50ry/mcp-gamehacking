// Quick compilation test for Step2_GenerateBSimSignatures.java
// This checks if the modified code compiles without syntax errors

import java.io.*;
import java.nio.file.*;
import javax.tools.*;

public class TestStep2Compilation {
    public static void main(String[] args) {
        try {
            // Get the Java compiler
            JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
            if (compiler == null) {
                System.out.println("No compiler available");
                System.exit(1);
            }

            // Compile the script
            String scriptPath = "/opt/re-universe/ghidra-scripts/Step2_GenerateBSimSignatures.java";
            int result = compiler.run(null, null, null, "-cp", "/opt/ghidra/Ghidra/Framework/Docking/lib/docking.jar:/opt/ghidra/Ghidra/Framework/SoftwareModeling/lib/SoftwareModeling.jar:/opt/ghidra/Ghidra/Features/Base/lib/Base.jar", scriptPath);

            if (result == 0) {
                System.out.println("✓ Step2_GenerateBSimSignatures.java compiles successfully!");
            } else {
                System.out.println("✗ Compilation failed with exit code: " + result);
            }

        } catch (Exception e) {
            System.out.println("Error during compilation test: " + e.getMessage());
            e.printStackTrace();
        }
    }
}