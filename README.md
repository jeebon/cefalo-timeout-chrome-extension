# Cefalo Timeout Extension

The Cefalo Timeout Extension enhances the attendance reports in the Cefalo HR Portal by adding a "Secure End Time" column and displaying time spent information since the first entry.

## Features

- **Secure End Time Column**: Automatically calculates and displays the recommended leave time based on minimum required hours.

- **Time Spent Calculation**: Shows the duration spent since the first entry to help users track their attendance.

- **Local Processing**: All data processing occurs locally within the user's browser without transmitting any personal information.

## Installation

You can install the Cefalo Timeout Extension directly from the [Chrome Web Store]('#') once it's published.

## Contributing

We welcome contributions to improve the Cefalo Timeout Extension. To contribute:

1. Fork the repository and clone it locally:

    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2. Create a new branch for your feature or bug fix:

    ```bash
    git checkout -b feature/new-feature
    ```

3. Make your changes, commit them with a descriptive message:

    ```bash
    git add .
    git commit -m "Add new feature: Describe your changes"
    ```

4. Push your changes to your fork:

    ```bash
    git push origin feature/new-feature
    ```

## Permissions Justification

### ActiveTab Permission

The `activeTab` permission is required to access and modify the contents of the Cefalo HR Portal’s Attendance tab. This allows the extension to add the "Secure End Time" column and display the time spent information.

### Host Permission

The `host` permission ensures the extension operates exclusively within the Cefalo HR Portal domain, enhancing security and privacy for users.

## Privacy Policy

For information about how we handle your data, please refer to our [Privacy Policy]('https://jeebon.github.io/cefalo-timeout-chrome-extension/privacy.html').

## Upload to Chrome Web Store: 

Instead of using the default Mac compression, use the following command:

  ```bash
  zip -r archive.zip ./*
  ```

## License

This project is licensed under the MIT License.
