import java.util.Scanner;

public class ReadUser {
    static String describe(Scanner in) {
        System.out.print("Возраст: ");
        int age = in.nextInt();
        System.out.print("Имя: ");
        String name = in.nextLine();
        return name + ", " + age;
    }
}
